"""
WebSocket URL routing for Django Channels.
Maps WebSocket connections to appropriate consumers.
"""

from django.urls import path
from . import consumers

websocket_urlpatterns = [
    path("ws/chat/<int:user_id>/", consumers.ChatConsumer.as_asgi(), name="chat"),
]
