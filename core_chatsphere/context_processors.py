from core_chatsphere.models import Notification

def unread_notifications_count(request):
    """
    Context processor that adds unread_notifications_count to the template context
    for authenticated users.
    """
    if request.user.is_authenticated:
        count = Notification.objects.filter(user=request.user, is_read=False).count()
        return {"unread_notifications_count": count}
    return {"unread_notifications_count": 0}
