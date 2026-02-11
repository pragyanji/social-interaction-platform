"""
Utility functions for ChatSphere platform.
Includes streak tracking, aura calculations, and user activity handling.
"""
from django.contrib.auth import get_user_model

User = get_user_model()


def update_user_activity(user):
    """
    Track user activity for streak calculation.

    Call this function when user:
    - Logs in
    - Starts video chat
    - Sends a message
    - Takes any active action on the platform

    This will:
    1. Update the user's daily streak (consecutive login days)
    2. Recalculate AuraPoints if needed

    Args:
        user: The User instance to update

    Returns:
        dict with 'current_streak' and 'aura_points' after update
    """
    from .models import DailyStreak, AuraPoints

    # Update daily streak
    daily_streak, created = DailyStreak.objects.get_or_create(user=user)
    daily_streak.update_streak()

    # Ensure AuraPoints exist and recalculate
    aura_points, _ = AuraPoints.objects.get_or_create(user=user)
    aura_points.recalc()

    return {
        'current_streak': daily_streak.current_streak,
        'aura_points': aura_points.aura_points
    }


def get_user_aura_tier(aura_points):
    """
    Get the aura tier badge for a user based on their total aura points.

    Tier Breakdown:
    - Bronze: 0-100 points (New User)
    - Silver: 101-300 points (Trusted)
    - Gold: 301-750 points (Reliable)
    - Platinum: 751-1500 points (Excellent)
    - Diamond: 1500+ points (Legendary)

    Args:
        aura_points (int): The user's total aura points

    Returns:
        dict with 'tier', 'emoji', and 'label'
    """
    if aura_points < 101:
        return {
            'tier': 'BRONZE',
            'emoji': '🟤',
            'label': 'New User',
            'min': 0,
            'max': 100
        }
    elif aura_points < 301:
        return {
            'tier': 'SILVER',
            'emoji': '🟡',
            'label': 'Trusted',
            'min': 101,
            'max': 300
        }
    elif aura_points < 751:
        return {
            'tier': 'GOLD',
            'emoji': '🟢',
            'label': 'Reliable',
            'min': 301,
            'max': 750
        }
    elif aura_points < 1501:
        return {
            'tier': 'PLATINUM',
            'emoji': '💎',
            'label': 'Excellent',
            'min': 751,
            'max': 1500
        }
    else:
        return {
            'tier': 'DIAMOND',
            'emoji': '👑',
            'label': 'Legendary',
            'min': 1501,
            'max': float('inf')
        }


def get_aura_breakdown(user):
    """
    Get a detailed breakdown of a user's aura points calculation.

    Returns all component values that make up the total aura.

    Args:
        user: The User instance

    Returns:
        dict with all aura components and tier info
    """
    from .models import AuraPoints

    try:
        aura_obj = AuraPoints.objects.get(user=user)
    except AuraPoints.DoesNotExist:
        return {
            'total': 0,
            'rating_component': 0,
            'streak_component': 0,
            'verified_bonus': 0,
            'report_penalty': 0,
            'tier': get_user_aura_tier(0),
            'exists': False
        }

    tier = get_user_aura_tier(aura_obj.aura_points)

    # Check if user is verified for the verified bonus
    from .models import IdentityVerification
    verified_bonus = 0
    try:
        verification = IdentityVerification.objects.get(user=user)
        if verification.verification_status == IdentityVerification.VerificationStatus.VERIFIED:
            verified_bonus = 50
    except IdentityVerification.DoesNotExist:
        pass

    return {
        'total': aura_obj.aura_points,
        'rating_component': aura_obj.rating_component,
        'streak_component': aura_obj.streak_component,
        'verified_bonus': verified_bonus,
        'report_penalty': aura_obj.report_penalty,
        'tier': tier,
        'exists': True
    }
