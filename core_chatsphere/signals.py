from __future__ import annotations
from django.dispatch import receiver
from allauth.account.signals import user_signed_up
from .models import AuraPoints, DailyStreak


@receiver(user_signed_up)
def create_aura_for_social_signup(request, user, **kwargs):
    AuraPoints.objects.get_or_create(user=user)
    DailyStreak.objects.get_or_create(user=user)
