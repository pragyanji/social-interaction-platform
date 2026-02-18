"""
Custom allauth adapter to fix MultipleObjectsReturned issue and skip intermediate OAuth page.
"""
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.socialaccount.models import SocialApp
from django.contrib.sites.shortcuts import get_current_site
from allauth.account.adapter import DefaultAccountAdapter


class CustomSocialAccountAdapter(DefaultSocialAccountAdapter):
    def get_app(self, request, provider, client_id=None):
        """
        Override to fix MultipleObjectsReturned error by using .distinct().
        """
        try:
            site = get_current_site(request)

            # Build queryset with distinct to avoid duplicate results
            qs = SocialApp.objects.filter(
                provider=provider,
                sites=site
            ).distinct()

            if client_id:
                qs = qs.filter(client_id=client_id)

            # Use first() instead of get() to avoid MultipleObjectsReturned
            app = qs.first()
            if app is None:
                # Fallback: try without site filtering
                qs = SocialApp.objects.filter(provider=provider).distinct()
                if client_id:
                    qs = qs.filter(client_id=client_id)
                app = qs.first()

            if app is None:
                raise SocialApp.DoesNotExist(f"No SocialApp found for provider: {provider}")

            return app
        except Exception as e:
            # If anything fails, call parent implementation
            return super().get_app(request, provider, client_id)

    def pre_social_login(self, request, sociallogin):
        """
        Override to automatically link existing accounts and skip the intermediate page.
        This method is called before the user is redirected to social login.
        """
        # Check if a user with this email already exists
        if sociallogin.is_existing:
            return

        # Try to find a user by email
        try:
            from core_chatsphere.models import User
            email = sociallogin.account.extra_data.get('email', '')

            if email:
                existing_user = User.objects.get(email=email)
                # Connect the social account to the existing user
                sociallogin.connect(request, existing_user)
        except (User.DoesNotExist, AttributeError, KeyError):
            # No existing user with this email, allow normal signup
            pass

    def is_auto_signup_allowed(self, request, sociallogin):
        """
        Auto-signup is always allowed for Google OAuth.
        """
        return True
