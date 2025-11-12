"""
Custom allauth adapter to fix MultipleObjectsReturned issue.
"""
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.socialaccount.models import SocialApp
from django.contrib.sites.shortcuts import get_current_site


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
