"""
ASGI config for chatsphere project with Django Channels support.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/asgi/
"""

import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
import core_chatsphere.routing

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chatsphere.settings')

# Initialize Django ASGI application early to ensure the AppRegistry
# is populated before importing models
django_asgi_app = get_asgi_application()

application = ProtocolTypeRouter({
    # Django's ASGI application to handle traditional HTTP requests
    "http": django_asgi_app,

    # WebSocket chat handler with authentication
    "websocket": AuthMiddlewareStack(
        URLRouter(
            core_chatsphere.routing.websocket_urlpatterns
        )
    ),
})

