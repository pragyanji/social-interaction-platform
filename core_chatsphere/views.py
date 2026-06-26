from __future__ import annotations
from django.views.decorators.http import require_POST

import json
from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model, login, logout, authenticate, update_session_auth_hash
from .video_chat_config import FIREBASE_CONFIG
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm, PasswordChangeForm
from django.shortcuts import render, redirect, resolve_url, get_object_or_404
from django.utils.http import url_has_allowed_host_and_scheme
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django import forms
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
from . models import AuraPoints
from django.core.paginator import Paginator


from . import models
from .serializers import ConversationMessageSerializer
from django.db.models import Avg, Count

User = get_user_model()


# ---------- Forms ----------
class SignupForm(UserCreationForm):
    """
    Create users for your custom User model with extra fields.
    """
    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("username", "full_name", "email", "profile_pic")


class ProfileEditForm(forms.ModelForm):
    """
    Form for editing user profile information.
    """
    class Meta:
        model = User
        fields = ("full_name", "email", "profile_pic")
        widgets = {
            'full_name': forms.TextInput(attrs={
                'class': 'form-input',
                'placeholder': 'Enter your full name'
            }),
            'email': forms.EmailInput(attrs={
                'class': 'form-input',
                'placeholder': 'Enter your email address'
            }),
            'profile_pic': forms.FileInput(attrs={
                'class': 'form-input',
                'accept': 'image/*'
            })
        }

    def clean_email(self):
        email = self.cleaned_data.get('email')
        # Check if email is already used by another user
        if User.objects.filter(email=email).exclude(pk=self.instance.pk).exists():
            raise forms.ValidationError('This email is already in use.')
        return email


# ---------- Helpers ----------
def _safe_next(request, fallback="home"):
    nxt = request.POST.get("next") or request.GET.get("next")
    if nxt and url_has_allowed_host_and_scheme(nxt, {request.get_host()}):
        return nxt
    return resolve_url(fallback)



def landing_page(request):
    # Redirect authenticated users to home page
    if request.user.is_authenticated:
        return redirect("home")
    return render(request, "landing.html")


def privacy_policy(request):
    """
    Display the privacy policy page.
    Accessible to both authenticated and unauthenticated users.
    """
    return render(request, "privacy_policy.html")


@login_required(login_url="signin")
def start_video_chat(request):
    # Check if the user's banned status is active or not
    if models.BannedAcc.objects.filter(user=request.user, active=True).exists():
        messages.error(request, "You are banned from using Video Chat feature. Please contact support for more information.")
        return redirect("home")

    user = request.user

    # If the user already declared they are below 18, block access
    if user.age == 0:
        messages.error(request, "Video Chat is only available for users aged 18 and above.")
        return redirect("home")

    # If the user has never declared their age, show the verification page
    if user.age is None:
        if request.method == "POST":
            choice = request.POST.get("age_choice")
            if choice == "above":
                user.age = 1
                user.save(update_fields=["age"])
                return redirect("startvideochat")
            elif choice == "below":
                user.age = 0
                user.save(update_fields=["age"])
                messages.error(request, "Video Chat is only available for users aged 18 and above.")
                return redirect("home")
            else:
                # Invalid or missing choice — re-show the page
                return render(request, "age_verification.html")
        else:
            return render(request, "age_verification.html")

    context = {
        'firebase_config': json.dumps(FIREBASE_CONFIG),
    }
    return render(request, "start_video_chat.html", context)

def user_bidirectional_connections(request):
    """Return a list of bidirectionally connected users for the current user"""
    outgoing_ids = set(
        models.Connection.objects.filter(user=request.user).values_list('connection_with', flat=True)
    )
    incoming_ids = set(
        models.Connection.objects.filter(connection_with=request.user).values_list('user', flat=True)
    )
    mutual_ids = outgoing_ids & incoming_ids
    connected_users = User.objects.filter(id__in=mutual_ids)
    return connected_users

@login_required(login_url="signin")
def start_message_chat(request, user_id=None): 
    # Check if the user's banned status is active or not
    if models.BannedAcc.objects.filter(user=request.user, active=True).exists():
        messages.error(request, "You are banned from using Message feature. Please contact support for more information.")
        return redirect("home")
    # Get only bidirectionally connected users
    connected_users = user_bidirectional_connections(request)
    user_connections = connected_users.values_list('id', flat=True)

    from django.db.models import Count, Q as DQ
    connected_users = User.objects.filter(id__in=user_connections).annotate(
        unread_count=Count(
            'sent_messages',
            filter=DQ(sent_messages__receiver=request.user, sent_messages__is_read=False)
        )
    )
    
    selected_user = None
    if user_id:
        try:
            selected_user = User.objects.get(id=user_id)
            if selected_user not in connected_users:
                messages.error(request, "You can only message connected users!")
                return redirect("startmessagechat")
        except User.DoesNotExist:
            messages.error(request, "User not found!")
            return redirect("startmessagechat")
    
    context = {
        'connected_users': connected_users,
        'selected_user': selected_user,
    }
    return render(request, "start_message_chat.html", context)


@login_required(login_url="signin")
def connections(request):
    # Bidirectional: only show users where BOTH directions of the connection exist
    
    connected_users = user_bidirectional_connections(request)

    context = {
        'connections': connected_users,
        'firebase_config': json.dumps(FIREBASE_CONFIG),
    }
    return render(request, "connections.html", context)


@login_required(login_url="signin")
def remove_connection(request, user_id):
    """Remove a connection between the current user and another user"""
    if request.method == "POST":
        try:
            # Delete the connection record
            models.Connection.objects.filter(user=request.user, connection_with_id=user_id).delete()
            # Also delete the reverse connection if it exists
            models.Connection.objects.filter(user_id=user_id, connection_with=request.user).delete()
            messages.success(request, "Connection removed successfully!")
        except Exception as e:
            messages.error(request, f"Error removing connection: {str(e)}")
    
    return redirect("connections")


@login_required(login_url="signin")
def home(request):
    # Get or create aura points
    aura, created = models.AuraPoints.objects.get_or_create(user=request.user)

    # Get or create daily streak and update it
    streak, streak_created = models.DailyStreak.objects.get_or_create(user=request.user)
    streak.update_streak()

    # Recalculate aura points after streak update
    aura.recalc()

    return render(request, "home.html", {
        'aura_points': aura.aura_points,
        'streak_days': streak.current_streak,
        'longest_streak': streak.longest_streak,
        'firebase_config': json.dumps(FIREBASE_CONFIG),
    })


@login_required(login_url="signin")
def profile_view(request): 
    user = request.user
    
    connection_with = user
    # Get or create aura points
    aura, created = models.AuraPoints.objects.get_or_create(user=user)

    # Recalculate to ensure latest values (ratings, streaks, verification, reports)
    aura.recalc()

    # Calculate average rating
    ratings_stats = models.RatingPoints.objects.filter(given_to=user).aggregate(
        avg_rating=Avg('rate_points'),
        total_ratings=Count('id')
    )
    # Get total bidirectional connections
    total_connections = user_bidirectional_connections(request).count()

    # Get list of connected users
    user_connections = user_bidirectional_connections(request).values_list('id', flat=True)
    connected_users_list = User.objects.filter(id__in=user_connections).all()[:5]

    # Get daily streak information
    streak, _ = models.DailyStreak.objects.get_or_create(user=user)
    streak_days = streak.current_streak
    longest_streak = streak.longest_streak

    context = {
        'user': user,
        'aura_points': aura.aura_points,
        'avg_rating': ratings_stats['avg_rating'] or 0,
        'total_ratings': ratings_stats['total_ratings'],
        'total_connections': total_connections or 0,
        'user_connections': connected_users_list,
        'streak_days': streak_days,
        'longest_streak': longest_streak,
    }
    
    return render(request, "profile.html", context)


def signup_view(request):
    # Redirect authenticated users to home page
    if request.user.is_authenticated:
        return redirect("home")

    if request.method == "POST":
        form = SignupForm(request.POST, request.FILES)
        if form.is_valid():
            user = form.save()
            models.AuraPoints.objects.get_or_create(user=user)

            # Authenticate to set the backend attribute
            raw_password = form.cleaned_data.get("password1")
            auth_user = authenticate(request, username=user.username, password=raw_password)

            if auth_user is not None:
                login(request, auth_user)  # backend already set by authenticate()
            else:
                # very rare fallback: explicitly choose a backend
                login(request, user, backend="django.contrib.auth.backends.ModelBackend")

            messages.success(request, "Welcome to Chatsphere! Your account is ready.")
            return redirect(_safe_next(request, "home"))
        else:
            messages.error(request, "Please fix the errors below.")
    else:
        form = SignupForm()

    context = {"form": form}
    return render(request, "signup.html", context)


def signin_view(request):
    # Redirect authenticated users to home page
    if request.user.is_authenticated:
        return redirect("home")

    if request.method == "POST":
        form = AuthenticationForm(request, data=request.POST)
        if form.is_valid():
            user = form.get_user()
            login(request, user)
            messages.success(request, "Signed in successfully.")
            return redirect(_safe_next(request, "home"))
        else:
            messages.error(request, "Invalid credentials. Please try again.")
    else:
        form = AuthenticationForm(request)

    context = {"form": form}
    return render(request, "signin.html", context)

@login_required(login_url="signin")
def logout_view(request):
    """
    Use as a POST action (your base.html already shows a POST form).
    """
    if request.method == "POST":
        logout(request)
        messages.info(request, "You have been signed out.")
    return redirect("landing")



@login_required(login_url="signin")
@require_http_methods(["POST"])
def report_user(request):
    """
    Handle user reports during video chat.
    Users can report strangers for inappropriate behavior.
    """
    try:
        # Parse JSON data from request body
        data = json.loads(request.body)
        room_id = data.get('room_id')
        reported_user_id = data.get('reported_user_id')
        reason = data.get('reason')
        description = data.get('description')

        # Validate required fields
        if not all([room_id, reported_user_id, reason, description]):
            return JsonResponse({
                'success': False,
                'error': 'Missing required fields'
            }, status=400)

        # Get the reported user
        try:
            reported_user = User.objects.get(id=reported_user_id)
        except User.DoesNotExist:
            return JsonResponse({
                'success': False,
                'error': 'Reported user not found'
            }, status=404)

        # Prevent self-reporting
        if reported_user.id == request.user.id:
            return JsonResponse({
                'success': False,
                'error': 'You cannot report yourself'
            }, status=400)

        # Check for report limiting - only one report per day from same user to same target user
        from django.utils import timezone
        now = timezone.now()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=999999)

        existing_report = models.Report.objects.filter(
            user=request.user,
            reported_to=reported_user,
            created_at__range=(start_of_day, end_of_day)
        ).first()

        if existing_report:
            return JsonResponse({
                'success': False,
                'error': 'You have already reported this user today.'
            }, status=400)

        # Format the report description with room context
        report_desc = f"[Room: {room_id}] [Reason: {reason}]\n\n{description}"

        # Create the report
        report = models.Report.objects.create(
            user=request.user,
            reported_to=reported_user,
            report_desc=report_desc,
            report_status=models.Report.Status.OPEN
        )

        # Update aura points for the reported user (report penalty applies)
        aura_obj, _ = models.AuraPoints.objects.get_or_create(user=reported_user)
        aura_obj.recalc()

        return JsonResponse({
            'success': True,
            'message': 'Report submitted successfully',
            'report_id': report.id
        })

    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'error': 'Invalid JSON data'
        }, status=400)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@login_required(login_url="signin")
@require_http_methods(["POST"])
def submit_rating(request):
    """
    Handle user ratings during video chat.
    Users can rate strangers on a 1-5 scale.
    Rate limiting: One rating per user per rated user per day.
    """
    try:
        # Parse JSON data from request body
        data = json.loads(request.body)
        rated_user_id = data.get('rated_user_id')
        rate_points = data.get('rate_points')

        # Validate required fields
        if not rated_user_id or rate_points is None:
            return JsonResponse({
                'success': False,
                'error': 'Missing required fields'
            }, status=400)

        # Validate rating value (must be 1-5)
        try:
            rate_points = int(rate_points)
            if rate_points < 1 or rate_points > 5:
                return JsonResponse({
                    'success': False,
                    'error': 'Rating must be between 1 and 5'
                }, status=400)
        except (ValueError, TypeError):
            return JsonResponse({
                'success': False,
                'error': 'Invalid rating value'
            }, status=400)

        # Get the rated user
        try:
            rated_user = User.objects.get(id=rated_user_id)
        except User.DoesNotExist:
            return JsonResponse({
                'success': False,
                'error': 'Rated user not found'
            }, status=404)

        # Prevent self-rating
        if rated_user.id == request.user.id:
            return JsonResponse({
                'success': False,
                'error': 'You cannot rate yourself'
            }, status=400)

        # Check for rate limiting - only one rating per day from same user to same target user
        from django.utils import timezone
        now = timezone.now()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=999999)

        existing_rating = models.RatingPoints.objects.filter(
            given_by=request.user,
            given_to=rated_user,
            created_at__range=(start_of_day, end_of_day)
        ).first()

        if existing_rating:
            return JsonResponse({
                'success': False,
                'error': 'You have already rated this user today. Try again tomorrow.'
            }, status=400)

        # Create the rating
        rating = models.RatingPoints.objects.create(
            given_by=request.user,
            given_to=rated_user,
            rate_points=rate_points
        )

        # Update aura points for the rated user
        aura_obj, _ = models.AuraPoints.objects.get_or_create(user=rated_user)
        aura_obj.recalc()

        return JsonResponse({
            'success': True,
            'message': 'Rating submitted successfully',
            'rating_id': rating.id,
            'new_aura_points': aura_obj.aura_points
        })

    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'error': 'Invalid JSON data'
        }, status=400)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@login_required(login_url="signin")
@require_http_methods(["POST"])
def submit_connection(request):
    """
    Handle creating connections during video chat.
    Immediately creates bidirectional connection (no approval needed).
    """
    try:
        # Parse JSON data from request body
        data = json.loads(request.body)
        connection_user_id = data.get('connection_user_id')

        # Validate required fields
        if not connection_user_id:
            return JsonResponse({
                'success': False,
                'error': 'Missing required fields'
            }, status=400)

        # Get the user to connect with
        try:
            connection_user = User.objects.get(id=connection_user_id)
        except User.DoesNotExist:
            return JsonResponse({
                'success': False,
                'error': 'User not found'
            }, status=404)

        # Prevent self-connection
        if connection_user.id == request.user.id:
            return JsonResponse({
                'success': False,
                'error': 'You cannot connect with yourself'
            }, status=400)

        # Check if already connected
        existing_connection = models.Connection.objects.filter(
            user=request.user,
            connection_with=connection_user
        ).first()

        if existing_connection:
            return JsonResponse({
                'success': False,
                'error': 'You are already connected with this user'
            }, status=400)

        # Create unidirectional connections immediately
        connection1 = models.Connection.objects.create(
            user=request.user,
            connection_with=connection_user
        )

        # Create bidirectional connections immediately
        # connection2 = models.Connection.objects.create(
        #     user=connection_user,
        #     connection_with=request.user
        # )

        return JsonResponse({
            'success': True,
            'message': 'Connected successfully!',
            'connection_id': connection1.id
        })

    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'error': 'Invalid JSON data'
        }, status=400)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@login_required(login_url="signin")
def edit_profile(request):
    """
    Allow users to edit their profile information including:
    - Full name
    - Email
    - Profile picture
    """
    if request.method == 'POST':
        form = ProfileEditForm(request.POST, request.FILES, instance=request.user)
        if form.is_valid():
            form.save()
            messages.success(request, 'Your profile has been updated successfully!')
            return redirect('profile')
        else:
            messages.error(request, 'Please correct the errors below.')
    else:
        form = ProfileEditForm(instance=request.user)

    return render(request, 'edit_profile.html', {
        'form': form,
        'user': request.user
    })


@login_required(login_url="signin")
def change_password(request):
    """
    Allow users to change their password.
    """
    if request.method == 'POST':
        form = PasswordChangeForm(request.user, request.POST)
        if form.is_valid():
            user = form.save()
            # Important: Update the session to prevent logout
            update_session_auth_hash(request, user)
            messages.success(request, 'Your password has been changed successfully!')
            return redirect('profile')
        else:
            messages.error(request, 'Please correct the errors below.')
    else:
        form = PasswordChangeForm(request.user)

    return render(request, 'change_password.html', {
        'form': form
    })


@login_required(login_url="signin")
@require_http_methods(["GET"])
def get_peer_stats(request, user_id):
    """
    Fetch peer user's aura points, rating, and new user status for video chat display.
    A user is considered "new" if:
    - Account age < 4 days AND
    - Number of ratings received < 3
    """
    try:
        # Get the peer user
        try:
            peer_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return JsonResponse({
                'success': False,
                'error': 'User not found'
            }, status=404)

        # Get or create aura points and recalculate
        aura, _ = models.AuraPoints.objects.get_or_create(user=peer_user)
        aura.recalc()

        # Get average rating and total ratings count
        ratings_stats = models.RatingPoints.objects.filter(given_to=peer_user).aggregate(
            avg_rating=Avg('rate_points'),
            total_ratings=Count('id')
        )

        # Check if user is new
        from django.utils import timezone
        from datetime import timedelta

        account_age_days = (timezone.now() - peer_user.date_joined).days
        total_ratings = ratings_stats['total_ratings'] or 0
        is_new_user = account_age_days < 4 and total_ratings < 3

        return JsonResponse({
            'success': True,
            'aura_points': aura.aura_points,
            'avg_rating': round(ratings_stats['avg_rating'] or 0, 1),
            'total_ratings': total_ratings,
            'is_new_user': is_new_user,
            'account_age_days': account_age_days
        })

    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)

# ---------- REST API Views for Messaging ----------

@login_required(login_url="signin")
@api_view(['GET'])
def get_message_history(request, user_id):
    """
    API endpoint to get message history between the current user and another user.
    GET /api/messages/<user_id>/
    """
    try:
        other_user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response(
            {'error': 'User not found'},
            status=status.HTTP_404_NOT_FOUND
        )

    # Get all messages between the two users, ordered chronologically
    messages_qs = models.ConversationMessage.objects.filter(
        (models.Q(sender=request.user, receiver=other_user) |
         models.Q(sender=other_user, receiver=request.user))
    ).order_by('created_at')

    serializer = ConversationMessageSerializer(messages_qs, many=True)
    return Response({
        'success': True,
        'messages': serializer.data,
        'other_user': {
            'id': other_user.id,
            'username': other_user.username,
            'full_name': other_user.full_name,
        }
    })


@login_required(login_url="signin")
@api_view(['POST'])
def mark_messages_as_read(request, user_id):
    """
    API endpoint to mark all messages from a user as read.
    POST /api/messages/<user_id>/read/
    """
    try:
        other_user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response(
            {'error': 'User not found'},
            status=status.HTTP_404_NOT_FOUND
        )

    # Mark all unread messages from the other user as read
    updated_count = models.ConversationMessage.objects.filter(
        sender=other_user,
        receiver=request.user,
        is_read=False
    ).update(
        is_read=True,
        read_at=timezone.now()
    )

    return Response({
        'success': True,
        'marked_as_read': updated_count
    })

# Api view to get aura leaderboard
def aura_leaderboard(request):
    aura_qs = AuraPoints.objects.select_related('user').order_by('-aura_points')
    paginator = Paginator(aura_qs, 30)
    page = paginator.get_page(request.GET.get('page'))
    data = [
        {
            "id": entry.id,
            "username": entry.user.username,
            "aura_points": entry.aura_points,
        }
        for entry in page
    ]
    return JsonResponse({
        "results": data,
        "total": paginator.count,
        "page": page.number,
        "total_pages": paginator.num_pages
    })

# View to render aura leaderboard page for all users
@login_required(login_url="signin")
def aura_leaderboard_view(request):
    aura_qs = AuraPoints.objects.select_related('user').order_by('-aura_points')

    # Calculate current user's rank and aura
    user_aura = AuraPoints.objects.filter(user=request.user).first()
    if user_aura:
        user_rank = AuraPoints.objects.filter(aura_points__gt=user_aura.aura_points).count() + 1
        user_aura_points = user_aura.aura_points
    else:
        user_rank = None
        user_aura_points = 0

    paginator = Paginator(aura_qs, 30)
    page = paginator.get_page(request.GET.get('page'))
    context = {
        'aura_entries': page,
        'total': paginator.count,
        'user_rank': user_rank,
        'user_aura_points': user_aura_points,
    }
    return render(request, "aura_leaderboard.html", context)


# -------------------------------------------------------------
# CONTENT MODERATION, NOTIFICATIONS & POLICIES
# -------------------------------------------------------------

@login_required(login_url="signin")
@require_POST
def moderate_frame(request):
    """
    Receives a video chat frame, runs NudeNet locally to check for nudity/NSFW content.
    If confirmed, penalizes user aura, saves frame, sends warning notification,
    and bans user automatically on the 3rd strike.
    """
    import base64
    import json
    import uuid
    import tempfile
    import os
    from django.core.files.base import ContentFile
    from django.core.files.storage import default_storage
    from django.shortcuts import get_object_or_404
    from django.contrib.auth import get_user_model
    from nudenet import NudeDetector
    from .models import Notification, ModerationLog, Report, AuraPoints, BannedAcc
    
    # Cache the NudeDetector instance globally so it's loaded only once
    if not hasattr(moderate_frame, '_detector'):
        moderate_frame._detector = NudeDetector()

    try:
        data = json.loads(request.body)
        frame_data = data.get("frame")  # base64 JPEG format
        violating_user_id = data.get("user_id")  # User ID of the peer whose video was scanned
        
        if not frame_data or not violating_user_id:
            return JsonResponse({"error": "Missing parameters"}, status=400)
        
        # Resolve target violating user
        User = get_user_model()
        violating_user = get_object_or_404(User, id=violating_user_id)
        
        # Decode base64 frame
        format, imgstr = frame_data.split(';base64,') if ';base64,' in frame_data else (None, frame_data)
        image_data = base64.b64decode(imgstr)
        
        # Save frame temporarily for NudeNet scanning
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp_img:
            temp_img.write(image_data)
            temp_path = temp_img.name
        
        try:
            detector = moderate_frame._detector
            detections = detector.detect(temp_path)
            
            # Filter for explicit visual categories
            EXPLICIT_CLASSES = {
                "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED",
                "BUTTOCKS_EXPOSED", "ANUS_EXPOSED", "MALE_GENITALIA_EXPOSED"
            }
            violations = [d for d in detections if d["class"] in EXPLICIT_CLASSES and d["score"] > 0.6]
            is_nsfw = len(violations) > 0
            
            if is_nsfw:
                # 1. Save frame to media root under moderation/
                filename = f"violation_{violating_user.id}_{uuid.uuid4().hex[:8]}.jpg"
                saved_path = default_storage.save(f"moderation/{filename}", ContentFile(image_data))
                
                # 2. Get current violation counts
                existing_violations_count = ModerationLog.objects.filter(
                    user=violating_user,
                    content_type=ModerationLog.ContentType.VIDEO_NSFW,
                    action_taken__in=[ModerationLog.Action.WARNING, ModerationLog.Action.BAN]
                ).count()
                new_count = existing_violations_count + 1
                
                # 3. Deduct Aura points & create Report
                Report.objects.create(
                    user=request.user,  # Reporter is the peer
                    reported_to=violating_user,
                    report_desc="Automated Detection: Explicit video content (NSFW) detected on live call.",
                    report_status=Report.Status.CLOSED
                )
                
                # 4. Check Ban Threshold
                if new_count >= 3:
                    # Execute Ban
                    BannedAcc.objects.update_or_create(
                        user=violating_user,
                        defaults={
                            "banned_by": None,
                            "banned_reason": "Automated Content Moderation: 3 NSFW video chat violations confirmed.",
                            "active": True
                        }
                    )
                    
                    # Log Moderation action
                    ModerationLog.objects.create(
                        user=violating_user,
                        content_type=ModerationLog.ContentType.VIDEO_NSFW,
                        source=ModerationLog.Source.SERVER,
                        action_taken=ModerationLog.Action.BAN,
                        confidence=max([v["score"] for v in violations]),
                        image_path=saved_path,
                        details={"violations": violations}
                    )
                    
                    # Notification: Account Suspended
                    Notification.objects.create(
                        user=violating_user,
                        title="Your Account Has Been Banned",
                        message=(
                            "Your account has been permanently suspended due to repeated violations of our Terms of Service. "
                            "Violation #3: Explicit video content was confirmed by our verification system. "
                            "You are banned from using ChatSphere's matching and communication tools."
                        ),
                        image=saved_path
                    )
                    action_taken = "ban"
                else:
                    # Log Moderation action
                    ModerationLog.objects.create(
                        user=violating_user,
                        content_type=ModerationLog.ContentType.VIDEO_NSFW,
                        source=ModerationLog.Source.SERVER,
                        action_taken=ModerationLog.Action.WARNING,
                        confidence=max([v["score"] for v in violations]),
                        image_path=saved_path,
                        details={"violations": violations}
                    )
                    
                    # Notification: Warning Issued
                    Notification.objects.create(
                        user=violating_user,
                        title="Content Moderation Warning (NSFW Video)",
                        message=(
                            "Our automated systems detected inappropriate behavior/NSFW content on your video stream. "
                            f"This is violation #{new_count} of 3. Reaching 3 violations will result in an automatic account ban. "
                            "A penalty of 150 Aura Points has been applied to your account."
                        ),
                        image=saved_path
                    )
                    action_taken = "warning"
                
                # Recalculate aura points to enforce penalty
                aura_obj, _ = AuraPoints.objects.get_or_create(user=violating_user)
                aura_obj.recalc()
                
                return JsonResponse({
                    "status": "nsfw",
                    "action": action_taken,
                    "violations_count": new_count,
                    "message": "Nudity detected. Action: " + action_taken
                })
            
            else:
                return JsonResponse({"status": "safe", "message": "Frame classified as safe"})
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@login_required(login_url="signin")
def notifications_view(request):
    """Render the user notifications dashboard."""
    from .models import Notification
    user_notifications = Notification.objects.filter(user=request.user).order_by("-created_at")
    paginator = Paginator(user_notifications, 15)
    page = paginator.get_page(request.GET.get("page"))
    
    return render(request, "notifications.html", {"notifications": page})


@login_required(login_url="signin")
@require_POST
def mark_notifications_read(request):
    """Mark all unread notifications of the user as read."""
    from .models import Notification
    Notification.objects.filter(user=request.user, is_read=False).update(is_read=True)
    return JsonResponse({"status": "success"})


@login_required(login_url="signin")
@require_POST
def delete_notification(request, notif_id):
    """Delete a specific notification of the user."""
    from .models import Notification
    notification = get_object_or_404(Notification, id=notif_id, user=request.user)
    notification.delete()
    return JsonResponse({"status": "success"})


@login_required(login_url="signin")
@require_POST
def delete_all_notifications(request):
    """Delete all notifications of the user."""
    from .models import Notification
    Notification.objects.filter(user=request.user).delete()
    return JsonResponse({"status": "success"})


def terms_conditions(request):
    """Display the terms & conditions page."""
    return render(request, "terms_conditions.html")


@login_required(login_url="signin")
def banned_view(request):
    """
    Displays a custom suspension screen for banned accounts,
    including the reasons and violating screenshots.
    """
    from .models import BannedAcc, Notification
    ban = get_object_or_404(BannedAcc, user=request.user, active=True)
    notifications = Notification.objects.filter(
        user=request.user, 
        image__isnull=False
    ).exclude(image="").order_by("-created_at")
    
    return render(request, "banned.html", {"ban": ban, "violations": notifications})


@login_required(login_url="signin")
def check_user_status(request):
    """Check if the requesting user is banned or active. Returns JSON."""
    from .models import BannedAcc
    is_banned = BannedAcc.objects.filter(user=request.user, active=True).exists()
    return JsonResponse({"banned": is_banned})
