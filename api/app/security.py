from __future__ import annotations
import base64, hashlib, hmac, json, secrets, string
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .config import get_settings
_settings = get_settings()

def hash_api_key(raw: str) -> str:
    return hmac.new(_settings.api_key_pepper.encode(), raw.encode(), hashlib.sha256).hexdigest()

def generate_api_key() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(12))

def encrypt_payload(value: dict) -> bytes:
    key = base64.urlsafe_b64decode(_settings.data_encryption_key + "=" * (-len(_settings.data_encryption_key) % 4))
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(key).encrypt(nonce, json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode(), b"dexplay-session-v1")
    return nonce + ciphertext

def decrypt_payload(value: bytes) -> dict:
    key = base64.urlsafe_b64decode(_settings.data_encryption_key + "=" * (-len(_settings.data_encryption_key) % 4))
    plaintext = AESGCM(key).decrypt(value[:12], value[12:], b"dexplay-session-v1")
    return json.loads(plaintext)

def hash_claim(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
