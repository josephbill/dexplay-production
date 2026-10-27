from __future__ import annotations
import base64
from functools import lru_cache
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
    paypal_mode: str = "live"
    paypal_client_id: str = ""
    paypal_client_secret: str = ""
    paypal_webhook_id: str = ""
    paypal_individual_plan_id: str = ""
    paypal_clinic_plan_id: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    twilio_messaging_service_sid: str = ""
    allowed_origins: str = ""

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

    @model_validator(mode="after")
    def live_configuration(self):
        if self.app_env == "production" and self.paypal_mode != "live":
            raise ValueError("Production refuses non-live PayPal mode")
        return self

    @property
    def paypal_enabled(self) -> bool:
        return all((self.paypal_client_id, self.paypal_client_secret, self.paypal_webhook_id,
                    self.paypal_individual_plan_id, self.paypal_clinic_plan_id))

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
