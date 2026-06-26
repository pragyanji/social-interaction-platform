from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from . import views
from core_admin.views import aura_list

urlpatterns = [
    path("", views.landing_page, name="landing"),
    path("home/", views.home, name="home"),
    path("profile/", views.profile_view, name="profile"),
    path("profile/edit/", views.edit_profile, name="edit_profile"),
    path("profile/change-password/", views.change_password, name="change_password"),
    path("signup/", views.signup_view, name="signup"),
    path("signin/", views.signin_view, name="signin"),
    path("logout/", views.logout_view, name="logout"),
    path("start_video_chat/", views.start_video_chat, name="startvideochat"),
    path("start_message_chat/<int:user_id>/", views.start_message_chat, name="startmessagechat"),
    path("connections/", views.connections, name="connections"),
    path("connections/remove/<int:user_id>/", views.remove_connection, name="remove_connection"),
    path("privacy/", views.privacy_policy, name="privacy_policy"),
    path("report-user/", views.report_user, name="report_user"),
    path("submit-rating/", views.submit_rating, name="submit_rating"),
    path("submit-connection/", views.submit_connection, name="submit_connection"),
    path("auraleaderboard/", views.aura_leaderboard_view, name="auraleaderboard"),
    # REST API endpoints for messaging
    path("get-peer-stats/<int:user_id>/", views.get_peer_stats, name="get_peer_stats"),
    path("api/messages/<int:user_id>/", views.get_message_history, name="message_history"),
    path("api/messages/<int:user_id>/read/", views.mark_messages_as_read, name="mark_read"),
    path("api/aura/leaderboard/", views.aura_leaderboard, name="aura_leaderboard"),
    path("terms/", views.terms_conditions, name="terms_conditions"),
    path("notifications/", views.notifications_view, name="notifications"),
    path("banned/", views.banned_view, name="banned_view"),
    path("api/moderate-frame/", views.moderate_frame, name="moderate_frame"),
    path("api/notifications/mark-read/", views.mark_notifications_read, name="mark_notifications_read"),
    path("api/notifications/delete/<int:notif_id>/", views.delete_notification, name="delete_notification"),
    path("api/notifications/delete-all/", views.delete_all_notifications, name="delete_all_notifications"),
    path("api/check-status/", views.check_user_status, name="check_user_status"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)