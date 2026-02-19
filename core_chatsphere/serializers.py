"""
Serializers for REST API endpoints.
Converts model instances to JSON for API responses.
"""

from rest_framework import serializers
from .models import ConversationMessage


class ConversationMessageSerializer(serializers.ModelSerializer):
    """Serializer for ConversationMessage model."""

    sender_username = serializers.CharField(source='sender.username', read_only=True)
    sender_full_name = serializers.CharField(source='sender.full_name', read_only=True)
    receiver_username = serializers.CharField(source='receiver.username', read_only=True)

    class Meta:
        model = ConversationMessage
        fields = [
            'id',
            'sender',
            'sender_username',
            'sender_full_name',
            'receiver',
            'receiver_username',
            'conv_message',
            'created_at',
            'is_read',
            'read_at',
        ]
        read_only_fields = ['id', 'created_at', 'read_at']
