from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx


OT_TOOLBOX_FEED = "https://www.theottoolbox.com/feed/"
ALLOWED_HOSTS = {
    "theottoolbox.com",
    "www.theottoolbox.com",
    "physio-pedia.com",
    "www.physio-pedia.com",
}
RELEVANCE_TERMS = (
    "fine motor",
    "hand-eye",
    "hand eye",
    "dexterity",
    "visual motor",
    "color sort",
    "colour sort",
    "coordination",
    "motor activity",
)


def allowed_public_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        return (
            parsed.scheme == "https"
            and parsed.hostname in ALLOWED_HOSTS
            and parsed.username is None
            and parsed.password is None
            and parsed.port in (None, 443)
        )
    except ValueError:
        return False


def parse_ot_toolbox_feed(content: bytes) -> list[dict[str, str]]:
    root = ET.fromstring(content)
    candidates = []
    for item in root.findall("./channel/item"):
        title = item.findtext("title", default="").strip()
        url = item.findtext("link", default="").strip()
        summary = item.findtext("description", default="")
        categories = " ".join(
            category.text or "" for category in item.findall("category")
        )
        relevance_text = f"{title} {summary} {categories}".casefold()
        if not title or not allowed_public_url(url):
            continue
        if not any(term in relevance_text for term in RELEVANCE_TERMS):
            continue
        candidates.append(
            {
                "title": title[:240],
                "url": url,
                "publisher": "The OT Toolbox",
            }
        )
    return candidates


def candidate_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:40]

def age_range_matches(age_range: str, age_group: str) -> bool:
    target = {"4-6": (4, 6), "7-9": (7, 9), "10-12": (10, 12)}.get(age_group)
    if not target:
        return False
    normalized = age_range.casefold()
    if re.search(r"\ball ages\b|\ball children\b|\bevery age\b", normalized):
        return True
    ranges = re.findall(r"\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\b", normalized)
    if ranges:
        return any(int(start) <= target[1] and int(end) >= target[0] for start, end in ranges)
    return age_group in normalized


async def fetch_feed_candidates() -> list[dict[str, str]]:
    if not allowed_public_url(OT_TOOLBOX_FEED):
        raise ValueError("The configured discovery feed is outside the approved source allowlist")
    async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
        async with client.stream(
            "GET",
            OT_TOOLBOX_FEED,
            headers={"Accept": "application/rss+xml, application/xml, text/xml"},
        ) as response:
            response.raise_for_status()
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > 2_000_000:
                raise ValueError("The approved resource feed exceeded the 2 MB size limit")
            content = bytearray()
            async for chunk in response.aiter_bytes():
                content.extend(chunk)
                if len(content) > 2_000_000:
                    raise ValueError("The approved resource feed exceeded the 2 MB size limit")
    try:
        return parse_ot_toolbox_feed(bytes(content))
    except ET.ParseError as exc:
        raise ValueError("The approved resource feed could not be parsed") from exc


async def verify_candidate_link(url: str) -> tuple[str, datetime]:
    if not allowed_public_url(url):
        return "outside approved source allowlist", datetime.now(timezone.utc)
    checked_at = datetime.now(timezone.utc)
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=False) as client:
            response = await client.head(url)
        if 300 <= response.status_code < 400:
            return "redirect not followed", checked_at
        return f"HTTP {response.status_code}", checked_at
    except httpx.HTTPError as exc:
        return f"could not verify ({type(exc).__name__})", checked_at
