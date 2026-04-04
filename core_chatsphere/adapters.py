"""
Custom allauth adapter for ChatSphere.

Handles:
- Populating custom User fields (full_name) from Google profile data
- Auto-creating AuraPoints for new social-auth users
- Generating a unique username from the Google email if needed
"""

from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from core_chatsphere.models import AuraPoints


class CustomSocialAccountAdapter(DefaultSocialAccountAdapter):

    def populate_user(self, request, sociallogin, data):
        """
        Called when a new user is being created via social login.
        Populate extra fields on the custom User model.
        """
        user = super().populate_user(request, sociallogin, data)

        # Set full_name from Google profile (first + last)
        first = data.get("first_name", "")
        last = data.get("last_name", "")
        user.full_name = f"{first} {last}".strip()

        # If allauth didn't set a username, derive one from the email
        if not user.username:
            email = data.get("email", "")
            user.username = email.split("@")[0] if email else ""

        return user

    def save_user(self, request, sociallogin, form=None):
        """
        After saving the new user, create their AuraPoints record.
        """
        user = super().save_user(request, sociallogin, form)
        AuraPoints.objects.get_or_create(user=user)
        return user
