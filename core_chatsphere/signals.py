from __future__ import annotations
from django.dispatch import receiver
from django.db.models.signals import post_save
from allauth.account.signals import user_signed_up
from .models import AuraPoints, IdentityVerification, DailyStreak

@receiver(user_signed_up)
def create_aura_for_social_signup(request, user, **kwargs):
    AuraPoints.objects.get_or_create(user=user)
    DailyStreak.objects.get_or_create(user=user)


@receiver(post_save, sender=IdentityVerification)
def recalc_aura_on_verification(sender, instance, created, **kwargs):
    """
    Automatically recalculate AuraPoints when a user's verification status changes to VERIFIED.
    This ensures the 50-point verification bonus is applied immediately upon approval.

    Triggered when:
    - Admin approves identity verification in Django Admin
    - Verification status is changed to VERIFIED

    Effect:
    - AuraPoints are recalculated
    - User gains +50 verified bonus points
    - Previous ratings, streaks, and reports are factored in
    """
    # Only recalculate if verification_status is VERIFIED
    if instance.verification_status == IdentityVerification.VerificationStatus.VERIFIED:
        try:
            aura_points = AuraPoints.objects.get(user=instance.user)
            aura_points.recalc()
        except AuraPoints.DoesNotExist:
            # If AuraPoints doesn't exist, create it with recalculation
            aura_points = AuraPoints(user=instance.user)
            aura_points.recalc()
