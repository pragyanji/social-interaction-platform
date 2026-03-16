from django.urls import path
from . import views

app_name = 'core_admin'

urlpatterns = [
    # Dashboard
    path('', views.dashboard, name='dashboard'),

    # User management
    path('users/', views.user_list, name='user_list'),
    path('users/<int:user_id>/', views.user_detail, name='user_detail'),
    path('users/<int:user_id>/ban/', views.ban_toggle, name='ban_toggle'),

    # Report management
    path('reports/', views.report_list, name='report_list'),
    path('reports/<int:report_id>/', views.report_detail, name='report_detail'),
    path('reports/<int:report_id>/action/', views.report_action, name='report_action'),

    # Connections
    path('connections/', views.connections_list, name='connections_list'),

    # Aura leaderboard
    path('aura/', views.aura_list, name='aura_list'),
]
