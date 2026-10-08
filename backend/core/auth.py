from datetime import timedelta

from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import ApiToken


IDLE_LIMIT = timedelta(days=60)


class ApiTokenAuthentication(TokenAuthentication):
    """`Authorization: Token <key>` against per-device ApiToken rows."""

    model = ApiToken

    def authenticate_credentials(self, key):
        user, token = super().authenticate_credentials(key)
        now = timezone.now()
        if (now - (token.last_used or token.created)) > IDLE_LIMIT:
            token.delete()
            raise AuthenticationFailed("Signed out after a long period without use. Please sign in again.")
        if not token.last_used or (now - token.last_used).total_seconds() > 300:
            ApiToken.objects.filter(pk=token.pk).update(last_used=now)
        return user, token
