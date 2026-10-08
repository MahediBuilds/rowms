"""Create or update the company administrator from ADMIN_USERNAME / ADMIN_PASSWORD."""
import os

from django.core.management.base import BaseCommand

from core.models import Company, Role, User


class Command(BaseCommand):
    help = "Create/refresh the administrator account from environment variables"

    def handle(self, *args, **opts):
        username = os.environ.get("ADMIN_USERNAME", "").strip()
        password = os.environ.get("ADMIN_PASSWORD", "")
        if not username or not password:
            self.stdout.write("ADMIN_USERNAME / ADMIN_PASSWORD not set - skipping")
            return
        company, _ = Company.objects.get_or_create(code="IPOWER", defaults={"name": "Ipower Engineering Services LLP"})
        user, created = User.objects.get_or_create(username=username, defaults={"role": Role.ADMIN, "company": company})
        user.role = Role.ADMIN
        user.company = user.company or company
        user.is_staff = user.is_superuser = user.is_active = True
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS(f"Administrator '{username}' {'created' if created else 'updated'}"))
