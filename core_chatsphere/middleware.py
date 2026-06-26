class LoggingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Process the request without logging
        response = self.get_response(request)
        return response


from django.shortcuts import redirect
from django.urls import reverse
from core_chatsphere.models import BannedAcc

class BannedUserMiddleware:
    """
    Middleware that checks if an authenticated user is banned.
    Banned users are redirected to the banned_view suspend page.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated:
            # Bypass checks for static files, media files, logout, and the banned page
            try:
                banned_path = reverse('banned_view')
                logout_path = reverse('logout')
            except Exception:
                banned_path = '/banned/'
                logout_path = '/logout/'
            
            allowed_paths = [
                banned_path,
                logout_path,
                '/static/',
                '/media/'
            ]
            
            if not any(request.path.startswith(path) for path in allowed_paths):
                if BannedAcc.objects.filter(user=request.user, active=True).exists():
                    return redirect(banned_path)

        return self.get_response(request)

    