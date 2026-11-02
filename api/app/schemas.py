from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

class AnalysisRound(BaseModel):
    model_config = ConfigDict(extra="forbid")

    round_num: int = Field(ge=1, le=100)
    mode: Literal["sort_place", "stack", "thread", "button"]
    objects_placed: int = Field(ge=0, le=100)
    objects_total: int = Field(ge=1, le=100)
    avg_time: float = Field(ge=0, le=3600)
    fumbles: int = Field(ge=0, le=1000)
    accuracy: float = Field(ge=0, le=1)

class AnalysisDifficulty(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object_size_mm: int = Field(default=22, ge=12, le=60)
    time_limit_s: int | None = Field(default=75, ge=20, le=600)
    objects_count: int = Field(default=5, ge=1, le=30)
    zone_size_mm: int = Field(default=80, ge=20, le=250)
    speed_factor: float = Field(default=1, ge=0.25, le=2)

class AnalysisProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group: Literal["child", "clinic"] = "child"
    age_group: Literal["4-6", "7-9", "10-12"] = "7-9"
    language: str = Field(default="en", min_length=2, max_length=8)
    difficulty: AnalysisDifficulty = Field(default_factory=AnalysisDifficulty)
    recent_session_accuracy: list[float] = Field(default_factory=list, max_length=3)

    @field_validator("recent_session_accuracy")
    @classmethod
    def valid_accuracy_history(cls, values: list[float]) -> list[float]:
        if any(value < 0 or value > 1 for value in values):
            raise ValueError("Session accuracy values must be between 0 and 1")
        return values

class FreeAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_data: list[AnalysisRound] = Field(min_length=1, max_length=10)
    profile: AnalysisProfile

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
