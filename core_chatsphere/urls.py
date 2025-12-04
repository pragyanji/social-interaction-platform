from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from . import views

urlpatterns = [
    path("", views.landing_page, name="landing"),
    path("home/", views.home, name="home"),
    path("profile/", views.profile_view, name="profile"),
    # path("profile/<int:user_id>/", views.profile_view, name="profile"),
    path("signup/", views.signup_view, name="signup"),
    path("signin/", views.signin_view, name="signin"),
    path("logout/", views.logout_view, name="logout"),
    path("identity-verification/", views.identity_verification, name="identity_verification"),
    path("start_video_chat/", views.start_video_chat, name="startvideochat"),
    path("start_message_chat/", views.start_message_chat, name="startmessagechat"),
    path("start_message_chat/<int:user_id>/", views.start_message_chat, name="startmessagechat"),
    path("connections/", views.connections, name="connections"),
    path("connections/remove/<int:user_id>/", views.remove_connection, name="remove_connection"),
    path("report-user/", views.report_user, name="report_user"),

]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)