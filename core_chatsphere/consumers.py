"""
Django Channels WebSocket consumers for real-time messaging.
Handles sending and receiving messages in real-time.
"""

import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db.models import Q
from .models import ConversationMessage

User = get_user_model()


class ChatConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for real-time chat functionality."""

    async def connect(self):
        """Called when a WebSocket connection is established."""
        self.user_id = self.scope['url_route']['kwargs']['user_id']
        self.user = self.scope['user']
        self.room_name = f"chat_{min(self.user.id, self.user_id)}_{max(self.user.id, self.user_id)}"

        # Verify that the requesting user is allowed to chat with this user_id
        if not await self.can_chat():
            await self.close()
            return

        await self.channel_layer.group_add(self.room_name, self.channel_name)
        await self.accept()

        # Notify the other user that this user is now online
        await self.channel_layer.group_send(
            self.room_name,
            {
                'type': 'user_presence',
                'user_id': self.user.id,
                'status': 'online',
            }
        )

    async def disconnect(self, close_code):
        """Called when a WebSocket connection is closed."""
        # Notify the other user that this user is now offline
        if hasattr(self, 'room_name'):
            await self.channel_layer.group_send(
                self.room_name,
                {
                    'type': 'user_presence',
                    'user_id': self.user.id,
                    'status': 'offline',
                }
            )
        await self.channel_layer.group_discard(self.room_name, self.channel_name)

    async def receive(self, text_data):
        """Called when a message is received from the WebSocket."""
        try:
            data = json.loads(text_data)
            message_type = data.get('type')

            if message_type == 'chat_message':
                await self.handle_chat_message(data)
            elif message_type == 'mark_as_read':
                await self.handle_mark_as_read(data)
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Invalid JSON payload'
            }))

    async def handle_chat_message(self, data):
        """Handle incoming chat messages."""
        message = data.get('message', '').strip()

        if not message:
            return

        # Save message to database
        saved_message = await self.save_message(message)

        if saved_message:
            # Broadcast message to all users in the chat room
            await self.channel_layer.group_send(
                self.room_name,
                {
                    'type': 'chat_message',
                    'message': saved_message['conv_message'],
                    'sender_id': saved_message['sender'],
                    'receiver_id': saved_message['receiver'],
                    'created_at': saved_message['created_at'],
                    'message_id': saved_message['id'],
                    'is_read': saved_message['is_read'],
                }
            )

    async def handle_mark_as_read(self, data):
        """Handle marking messages as read."""
        message_id = data.get('message_id')

        if message_id:
            await self.mark_message_as_read(message_id)

            # Broadcast read receipt to all users in the room
            await self.channel_layer.group_send(
                self.room_name,
                {
                    'type': 'message_read',
                    'message_id': message_id,
                    'user_id': self.user.id,
                }
            )

    async def chat_message(self, event):
        """Send a chat message to the WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message': event['message'],
            'sender_id': event['sender_id'],
            'receiver_id': event['receiver_id'],
            'created_at': event['created_at'],
            'message_id': event['message_id'],
            'is_read': event['is_read'],
        }))

    async def message_read(self, event):
        """Send a message read receipt to the WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'message_read',
            'message_id': event['message_id'],
            'user_id': event['user_id'],
        }))

    async def user_presence(self, event):
        """Send a user presence update to the WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'user_presence',
            'user_id': event['user_id'],
            'status': event['status'],
        }))

    @database_sync_to_async
    def can_chat(self):
        """Check if the requesting user can chat with the target user."""
        from .models import Connection

        # Check if both users are connected (connection exists in either direction)
        return Connection.objects.filter(
            Q(user=self.user, connection_with_id=self.user_id) |
            Q(user_id=self.user_id, connection_with=self.user)
        ).exists()

    @database_sync_to_async
    def save_message(self, message):
        """Save a message to the database."""
        try:
            other_user = User.objects.get(id=self.user_id)
            msg = ConversationMessage.objects.create(
                sender=self.user,
                receiver=other_user,
                conv_message=message,
            )

            return {
                'id': msg.id,
                'sender': msg.sender.id,
                'receiver': msg.receiver.id,
                'conv_message': msg.conv_message,
                'created_at': msg.created_at.isoformat(),
                'is_read': msg.is_read,
            }
        except User.DoesNotExist:
            return None

    @database_sync_to_async
    def mark_message_as_read(self, message_id):
        """Mark a message as read."""
        try:
            msg = ConversationMessage.objects.get(id=message_id)
            if msg.receiver == self.user and not msg.is_read:
                msg.is_read = True
                msg.read_at = timezone.now()
                msg.save()
                return True
        except ConversationMessage.DoesNotExist:
            pass
        return False
