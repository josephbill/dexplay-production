from __future__ import annotations
import base64
from functools import lru_cache
from typing import Literal
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

def async_database_url(value: str) -> str:
    """Normalize platform PostgreSQL URLs for this app's asyncpg driver."""
    if value.startswith("postgres://"):
        return "postgresql+asyncpg://" + value.removeprefix("postgres://")
    if value.startswith("postgresql://"):
        return "postgresql+asyncpg://" + value.removeprefix("postgresql://")
    return value

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: str = "production"
    public_origin: str
    database_url: str
    redis_url: str
    openai_api_key: str
    openai_model: str = "gpt-4o"
    data_encryption_key: str
    api_key_pepper: str
    paypal_mode: Literal["live", "sandbox"] = "live"
    paypal_client_id: str = ""
    paypal_client_secret: str = ""
    paypal_webhook_id: str = ""
    paypal_individual_plan_id: str = ""
    paypal_clinic_plan_id: str = ""
    paypal_sandbox_client_id: str = ""
    paypal_sandbox_client_secret: str = ""
    paypal_sandbox_webhook_id: str = ""
    paypal_sandbox_individual_plan_id: str = ""
    paypal_sandbox_clinic_plan_id: str = ""
    resource_reviewer_token: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    twilio_messaging_service_sid: str = ""
    allowed_origins: str = ""

    @field_validator("app_env", "paypal_mode", mode="before")
    @classmethod
    def normalize_environment_names(cls, value: str) -> str:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("data_encryption_key")
    @classmethod
    def valid_encryption_key(cls, value: str) -> str:
        try:
            decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        except Exception as exc:
            raise ValueError("DATA_ENCRYPTION_KEY must be URL-safe base64 for exactly 32 random bytes") from exc
        if len(decoded) != 32:
            raise ValueError("DATA_ENCRYPTION_KEY must decode to exactly 32 bytes")
        return value

    @field_validator("api_key_pepper")
    @classmethod
    def valid_pepper(cls, value: str) -> str:
        if len(value.encode()) < 32:
            raise ValueError("API_KEY_PEPPER must contain at least 32 bytes")
        return value

    @field_validator("resource_reviewer_token")
    @classmethod
    def valid_reviewer_token(cls, value: str) -> str:
        if value and len(value.encode()) < 32:
            raise ValueError("RESOURCE_REVIEWER_TOKEN must contain at least 32 bytes when configured")
        return value

    @model_validator(mode="after")
    def live_configuration(self):
        if self.app_env == "production" and self.paypal_mode != "live":
            raise ValueError("Production refuses non-live PayPal mode")
        return self

    @property
    def paypal_enabled(self) -> bool:
        return all((self.active_paypal_client_id, self.active_paypal_client_secret, self.active_paypal_webhook_id,
                    self.active_paypal_individual_plan_id, self.active_paypal_clinic_plan_id))

    @property
    def paypal_api_base(self) -> str:
        return "https://api-m.sandbox.paypal.com" if self.paypal_mode == "sandbox" else "https://api-m.paypal.com"

    @property
    def active_paypal_client_id(self) -> str:
        return self.paypal_sandbox_client_id if self.paypal_mode == "sandbox" else self.paypal_client_id

    @property
    def active_paypal_client_secret(self) -> str:
        return self.paypal_sandbox_client_secret if self.paypal_mode == "sandbox" else self.paypal_client_secret

    @property
    def active_paypal_webhook_id(self) -> str:
        return self.paypal_sandbox_webhook_id if self.paypal_mode == "sandbox" else self.paypal_webhook_id

    @property
    def active_paypal_individual_plan_id(self) -> str:
        return self.paypal_sandbox_individual_plan_id if self.paypal_mode == "sandbox" else self.paypal_individual_plan_id

    @property
    def active_paypal_clinic_plan_id(self) -> str:
        return self.paypal_sandbox_clinic_plan_id if self.paypal_mode == "sandbox" else self.paypal_clinic_plan_id

    @property
    def twilio_enabled(self) -> bool:
        return bool(self.twilio_account_sid and self.twilio_auth_token and
                    (self.twilio_from_number or self.twilio_messaging_service_sid))

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

@lru_cache
def get_settings() -> Settings:
    return Settings()
