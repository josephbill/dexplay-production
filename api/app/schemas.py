from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field

class SyncRequest(BaseModel):
    session_data: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    profile: dict[str, Any]
    subscription_state: Literal["free", "trial", "active", "lapsed"] = "free"
    usage_stats: dict[str, Any] = Field(default_factory=dict)
    resource_preferences: dict[str, Any] = Field(default_factory=dict)
    patient_id: str | None = Field(default=None, max_length=80)

class SubscriptionRequest(BaseModel):
    plan: Literal["individual", "clinic"]
    language: str = Field(min_length=2, max_length=8)
    phone_number: str | None = Field(default=None, min_length=8, max_length=20)
    sms_consent: bool = False

class ClaimRequest(BaseModel):
    activation_token: str = Field(min_length=32, max_length=96)

class KeyActivationRequest(BaseModel):
    api_key: str = Field(min_length=12, max_length=12)
    device_label: str = Field(default="device", max_length=80)
