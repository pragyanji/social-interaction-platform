from core_chatsphere.models import Notification, ConversationMessage

def unread_notifications_count(request):
    """
    Context processor that adds unread_notifications_count to the template context
    for authenticated users.
    """
    if request.user.is_authenticated:
        count = Notification.objects.filter(user=request.user, is_read=False).count()
        return {"unread_notifications_count": count}
    return {"unread_notifications_count": 0}

def unread_messages_count(request):
    """
    Context processor that adds unread_messages_count to the template context
    for authenticated users.
    """
    if request.user.is_authenticated:
        count = ConversationMessage.objects.filter(receiver=request.user, is_read=False).count()
        return {"unread_messages_count": count}
    return {"unread_messages_count": 0}
