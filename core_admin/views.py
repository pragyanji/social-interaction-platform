from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.core.paginator import Paginator
from django.db.models import Avg, Count, Q, Sum
from django.http import JsonResponse
from django.shortcuts import render, redirect, get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_POST

from core_chatsphere.models import (
    AuraPoints, BannedAcc, Connection, ConversationMessage,
    DailyStreak, RatingPoints, Report,
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
    total_users = User.objects.count()
    active_bans = BannedAcc.objects.filter(active=True).count()
    open_reports = Report.objects.filter(report_status=Report.Status.OPEN).count()
    under_review = Report.objects.filter(report_status=Report.Status.UNDER_REVIEW).count()
    total_connections = Connection.objects.count()
    total_messages = ConversationMessage.objects.count()

    avg_aura = AuraPoints.objects.aggregate(avg=Avg('aura_points'))['avg'] or 0

    # Recent activity
    recent_reports = Report.objects.select_related('user', 'reported_to').order_by('-created_at')[:5]
    recent_bans = BannedAcc.objects.select_related('user', 'banned_by').order_by('-created_at')[:5]
    recent_users = User.objects.order_by('-date_joined')[:5]

    context = {
        'total_users': total_users,
        'active_bans': active_bans,
        'open_reports': open_reports,
        'under_review': under_review,
        'total_connections': total_connections,
        'total_messages': total_messages,
        'avg_aura': round(avg_aura),
        'recent_reports': recent_reports,
        'recent_bans': recent_bans,
        'recent_users': recent_users,
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
        aura_total=Sum('aura__aura_points'),
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

    paginator = Paginator(aura_qs, 30)
    page = paginator.get_page(request.GET.get('page'))

    context = {
        'aura_entries': page,
        'total': paginator.count,
    }
    return render(request, 'core_admin/aura.html', context)
