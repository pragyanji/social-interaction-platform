from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.core.paginator import Paginator
from django.db.models import Avg, Count, OuterRef, Q, Subquery, Sum
from django.http import JsonResponse
from django.shortcuts import render, redirect, get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_POST

from core_chatsphere.models import (
    AuraPoints, BannedAcc, Connection, ConversationMessage,
    DailyStreak, RatingPoints, Report, ModerationLog,
)

User = get_user_model()


def admin_required(view_func):
    """Decorator: login + staff required."""
    return login_required(
        staff_member_required(view_func, login_url='signin'),
        login_url='signin',
    )


# ─────────────────────────────────────────────
# DASHBOARD
# ─────────────────────────────────────────────
@admin_required
def dashboard(request):
    import datetime
    
    total_users = User.objects.count()
    active_bans = BannedAcc.objects.filter(active=True).count()
    open_reports = Report.objects.filter(report_status=Report.Status.OPEN).count()
    under_review = Report.objects.filter(report_status=Report.Status.UNDER_REVIEW).count()
    total_connections = Connection.objects.count()
    total_moderation_logs = ModerationLog.objects.count()

    # Recent activity
    recent_reports = Report.objects.select_related('user', 'reported_to').order_by('-created_at')[:5]
    recent_bans = BannedAcc.objects.select_related('user', 'banned_by').order_by('-created_at')[:5]
    recent_users = User.objects.order_by('-date_joined')[:5]

    # --- Analytics & Statistics ---
    
    # 1. Signups in the last 7 days
    today = timezone.localdate()
    signup_trend = []
    for i in range(6, -1, -1):
        day = today - datetime.timedelta(days=i)
        count = User.objects.filter(date_joined__date=day).count()
        signup_trend.append({
            'date': day.strftime('%b %d'),
            'count': count
        })

    # 2. Aura Tier Distribution
    bronze_count = AuraPoints.objects.filter(aura_points__lte=100).count()
    silver_count = AuraPoints.objects.filter(aura_points__gt=100, aura_points__lte=300).count()
    gold_count = AuraPoints.objects.filter(aura_points__gt=300, aura_points__lte=750).count()
    platinum_count = AuraPoints.objects.filter(aura_points__gt=750, aura_points__lte=1500).count()
    diamond_count = AuraPoints.objects.filter(aura_points__gt=1500).count()
    
    aura_distribution = [
        {'tier': 'Bronze (0-100)', 'count': bronze_count, 'color': '#b45309'},
        {'tier': 'Silver (101-300)', 'count': silver_count, 'color': '#94a3b8'},
        {'tier': 'Gold (301-750)', 'count': gold_count, 'color': '#fbbf24'},
        {'tier': 'Platinum (751-1500)', 'count': platinum_count, 'color': '#22d3ee'},
        {'tier': 'Diamond (1500+)', 'count': diamond_count, 'color': '#a855f7'},
    ]

    # 3. Community Ratings Distribution (1-5 Stars)
    star_counts = RatingPoints.objects.values('rate_points').annotate(count=Count('id'))
    ratings_breakdown = {i: 0 for i in range(1, 6)}
    for sc in star_counts:
        ratings_breakdown[sc['rate_points']] = sc['count']
    
    total_ratings = sum(ratings_breakdown.values())
    ratings_percentage = []
    for star in range(5, 0, -1):
        count = ratings_breakdown[star]
        percentage = round((count / total_ratings * 100), 1) if total_ratings > 0 else 0
        ratings_percentage.append({
            'stars': star,
            'count': count,
            'percentage': percentage
        })

    # 4. Moderation action distribution
    warning_count = ModerationLog.objects.filter(action_taken=ModerationLog.Action.WARNING).count()
    ban_count = ModerationLog.objects.filter(action_taken=ModerationLog.Action.BAN).count()

    context = {
        'total_users': total_users,
        'active_bans': active_bans,
        'open_reports': open_reports,
        'under_review': under_review,
        'total_connections': total_connections,
        'total_moderation_logs': total_moderation_logs,
        'recent_reports': recent_reports,
        'recent_bans': recent_bans,
        'recent_users': recent_users,
        
        # Analytics context
        'signup_trend': signup_trend,
        'aura_distribution': aura_distribution,
        'ratings_percentage': ratings_percentage,
        'total_ratings': total_ratings,
        'mod_warnings': warning_count,
        'mod_bans': ban_count,
    }
    return render(request, 'core_admin/dashboard.html', context)


# ─────────────────────────────────────────────
# USER MANAGEMENT
# ─────────────────────────────────────────────
@admin_required
def user_list(request):
    q = request.GET.get('q', '').strip()
    filter_type = request.GET.get('filter', 'all')

    users = User.objects.annotate(
        aura_total=Subquery(
            AuraPoints.objects.filter(user=OuterRef('pk')).values('aura_points')[:1]
        ),
        rating_count=Count('ratings_received'),
        avg_rating=Avg('ratings_received__rate_points'),
    ).order_by('-date_joined')

    if q:
        users = users.filter(
            Q(username__icontains=q) |
            Q(full_name__icontains=q) |
            Q(email__icontains=q)
        )

    if filter_type == 'staff':
        users = users.filter(is_staff=True)
    elif filter_type == 'banned':
        banned_ids = BannedAcc.objects.filter(active=True).values_list('user_id', flat=True)
        users = users.filter(id__in=banned_ids)
    elif filter_type == 'active':
        users = users.filter(is_active=True)

    paginator = Paginator(users, 20)
    page = paginator.get_page(request.GET.get('page'))

    context = {
        'users': page,
        'q': q,
        'filter_type': filter_type,
        'total': paginator.count,
    }
    return render(request, 'core_admin/users.html', context)


@admin_required
def user_detail(request, user_id):
    user = get_object_or_404(User, id=user_id)

    aura, _ = AuraPoints.objects.get_or_create(user=user)
    aura.recalc()

    streak, _ = DailyStreak.objects.get_or_create(user=user)

    ratings_stats = RatingPoints.objects.filter(given_to=user).aggregate(
        avg=Avg('rate_points'), total=Count('id')
    )

    reports_received = Report.objects.filter(reported_to=user).order_by('-created_at')[:10]
    reports_made = Report.objects.filter(user=user).order_by('-created_at')[:10]

    ban = BannedAcc.objects.filter(user=user).first()

    # Connection count
    outgoing = set(Connection.objects.filter(user=user).values_list('connection_with_id', flat=True))
    incoming = set(Connection.objects.filter(connection_with=user).values_list('user_id', flat=True))
    mutual_count = len(outgoing & incoming)

    context = {
        'profile_user': user,
        'aura': aura,
        'streak': streak,
        'avg_rating': round(ratings_stats['avg'] or 0, 1),
        'total_ratings': ratings_stats['total'],
        'reports_received': reports_received,
        'reports_made': reports_made,
        'ban': ban,
        'mutual_connections': mutual_count,
    }
    return render(request, 'core_admin/user_detail.html', context)


@admin_required
@require_POST
def ban_toggle(request, user_id):
    user = get_object_or_404(User, id=user_id)
    action = request.POST.get('action', 'ban')
    reason = request.POST.get('reason', 'Banned by admin')

    if action == 'ban':
        BannedAcc.objects.update_or_create(
            user=user,
            defaults={
                'banned_by': request.user,
                'banned_reason': reason,
                'active': True,
            }
        )
        messages.success(request, f'{user.username} has been banned.')
    elif action == 'unban':
        BannedAcc.objects.filter(user=user).update(active=False)
        messages.success(request, f'{user.username} has been unbanned.')

    return redirect('core_admin:user_detail', user_id=user_id)


# ─────────────────────────────────────────────
# REPORT MANAGEMENT
# ─────────────────────────────────────────────
@admin_required
def report_list(request):
    status_filter = request.GET.get('status', 'all')
    q = request.GET.get('q', '').strip()

    reports = Report.objects.select_related('user', 'reported_to').order_by('-created_at')

    if status_filter != 'all':
        reports = reports.filter(report_status=status_filter)

    if q:
        reports = reports.filter(
            Q(user__username__icontains=q) |
            Q(reported_to__username__icontains=q) |
            Q(report_desc__icontains=q)
        )

    paginator = Paginator(reports, 20)
    page = paginator.get_page(request.GET.get('page'))

    context = {
        'reports': page,
        'status_filter': status_filter,
        'q': q,
        'total': paginator.count,
        'status_choices': Report.Status.choices,
    }
    return render(request, 'core_admin/reports.html', context)


@admin_required
def report_detail(request, report_id):
    report = get_object_or_404(
        Report.objects.select_related('user', 'reported_to'),
        id=report_id,
    )
    context = {
        'report': report,
        'status_choices': Report.Status.choices,
    }
    return render(request, 'core_admin/report_detail.html', context)


@admin_required
@require_POST
def report_action(request, report_id):
    report = get_object_or_404(Report, id=report_id)
    new_status = request.POST.get('status')

    valid_statuses = [s[0] for s in Report.Status.choices]
    if new_status in valid_statuses:
        report.report_status = new_status
        report.save(update_fields=['report_status'])
        messages.success(request, f'Report #{report.id} status changed to {report.get_report_status_display()}.')
    else:
        messages.error(request, 'Invalid status.')

    return redirect('core_admin:report_detail', report_id=report_id)


# ─────────────────────────────────────────────
# CONNECTIONS
# ─────────────────────────────────────────────
@admin_required
def connections_list(request):
    q = request.GET.get('q', '').strip()
    connections = Connection.objects.select_related('user', 'connection_with').order_by('-created_at')

    if q:
        connections = connections.filter(
            Q(user__username__icontains=q) |
            Q(connection_with__username__icontains=q)
        )

    paginator = Paginator(connections, 30)
    page = paginator.get_page(request.GET.get('page'))

    context = {
        'connections': page,
        'q': q,
        'total': paginator.count,
    }
    return render(request, 'core_admin/connections.html', context)


# ─────────────────────────────────────────────
# AURA LEADERBOARD
# ─────────────────────────────────────────────
@admin_required
def aura_list(request):
    aura_qs = AuraPoints.objects.select_related('user').order_by('-aura_points')

    paginator = Paginator(aura_qs, 10)
    page = paginator.get_page(request.GET.get('page'))

    context = {
        'aura_entries': page,
        'total': paginator.count,
    }
    return render(request, 'core_admin/aura.html', context)


# ─────────────────────────────────────────────
# CONTENT MODERATION LOGS
# ─────────────────────────────────────────────
@admin_required
def moderation_logs(request):
    """View to list all video violations logged by NudeNet verification."""
    from core_chatsphere.models import ModerationLog
    logs = ModerationLog.objects.select_related('user').order_by('-created_at')
    
    paginator = Paginator(logs, 20)
    page = paginator.get_page(request.GET.get("page"))
    
    context = {
        'logs': page,
        'total': paginator.count,
    }
    return render(request, 'core_admin/moderation_logs.html', context)


@admin_required
@require_POST
def send_user_notification(request, user_id):
    """Send a custom notification to a specific user."""
    user = get_object_or_404(User, id=user_id)
    title = request.POST.get('title', '').strip()
    message = request.POST.get('message', '').strip()
    
    if title and message:
        from core_chatsphere.models import Notification
        Notification.objects.create(
            user=user,
            title=title,
            message=message
        )
        messages.success(request, f'Notification sent successfully to {user.username}.')
    else:
        messages.error(request, 'Both title and message are required.')
        
    return redirect('core_admin:user_detail', user_id=user.id)


@admin_required
def send_broadcast(request):
    """Send a notification to all users (broadcast) or a specific user."""
    users_list = User.objects.filter(is_active=True).order_by('username')
    
    if request.method == 'POST':
        title = request.POST.get('title', '').strip()
        message = request.POST.get('message', '').strip()
        recipient_type = request.POST.get('recipient_type', 'all')
        target_username = request.POST.get('target_user', '').strip()
        
        if not title or not message:
            messages.error(request, 'Both title and message are required.')
            return render(request, 'core_admin/broadcast.html', {
                'users': users_list,
                'recipient_type': recipient_type,
                'target_user': target_username
            })
            
        from core_chatsphere.models import Notification
        
        if recipient_type == 'specific':
            selected_usernames = request.POST.getlist('selected_users')
            if not selected_usernames:
                messages.error(request, 'Please select at least one recipient user.')
                return render(request, 'core_admin/broadcast.html', {
                    'users': users_list,
                    'recipient_type': recipient_type,
                    'form_title': title,
                    'form_message': message,
                })
            
            selected_users = User.objects.filter(username__in=selected_usernames, is_active=True)
            if not selected_users.exists():
                messages.error(request, 'Selected users do not exist or are inactive.')
                return render(request, 'core_admin/broadcast.html', {
                    'users': users_list,
                    'recipient_type': recipient_type,
                    'form_title': title,
                    'form_message': message,
                })
            
            notifications = [
                Notification(user=u, title=title, message=message)
                for u in selected_users
            ]
            Notification.objects.bulk_create(notifications)
            messages.success(request, f'Notification sent successfully to {len(notifications)} selected user(s).')
            return redirect('core_admin:dashboard')
            
        else:
            users = User.objects.all()
            notifications = [
                Notification(user=u, title=title, message=message)
                for u in users
            ]
            Notification.objects.bulk_create(notifications)
            messages.success(request, f'Broadcast notification successfully sent to all {len(notifications)} users.')
            return redirect('core_admin:dashboard')
            
    return render(request, 'core_admin/broadcast.html', {'users': users_list})
