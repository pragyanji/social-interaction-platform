from __future__ import annotations

import json
from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model, login, logout, authenticate
from .video_chat_config import FIREBASE_CONFIG
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.shortcuts import render, redirect, resolve_url
from django.utils.http import url_has_allowed_host_and_scheme

# from .models import AuraPoints, RatingPoints, IdentityVerification, Connections
from . import models
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

    def save(self, commit=True):
        user = super().save(commit=False)
        # Optional: normalize email / other fields
        if self.cleaned_data.get("email"):
            user.email = self.cleaned_data["email"].strip().lower()
        user.full_name = self.cleaned_data.get("full_name", "")
        # separate the full name into first and last names
        name_parts = user.full_name.split()
        user.first_name = name_parts[0]
        if len(name_parts) > 1:
            user.last_name = name_parts[-1]
        if len(name_parts) > 2:
            user.first_name = " ".join(name_parts[:-1])
        user.profile_pic = self.cleaned_data.get("profile_pic")
        if commit:
            user.save()
        return user


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

@login_required(login_url="signin")
def start_video_chat(request):
    verification = models.IdentityVerification.objects.filter(user=request.user).first()
    if verification:
        verification_status = verification.verification_status
    else:
        verification_status = "Unverified"
    
    context = {
        'firebase_config': json.dumps(FIREBASE_CONFIG),
        'verification_status': verification_status,
    }
    return render(request, "start_video_chat.html", context)


@login_required(login_url="signin")
def start_message_chat(request, user_id=None):
    # Get all connected users
    user_connections = models.Connection.objects.filter(user=request.user).values_list('connection_with', flat=True)
    connected_users = User.objects.filter(id__in=user_connections)
    
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
        'firebase_config': json.dumps(FIREBASE_CONFIG),
    }
    return render(request, "start_message_chat.html", context)


@login_required(login_url="signin")
def connections(request):
    # Get all users this user is connected with
    user_connections = models.Connection.objects.filter(user=request.user).values_list('connection_with', flat=True)
    connected_users = User.objects.filter(id__in=user_connections)
    
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
    # Get or create aura points and verification status
    aura, created = models.AuraPoints.objects.get_or_create(user=request.user)
    verification = models.IdentityVerification.objects.filter(user=request.user).first()
    if verification:
        verification_status = verification.verification_status
    else:
        verification_status = "Unverified"
    
    # Get or create daily streak and update it
    streak, streak_created = models.DailyStreak.objects.get_or_create(user=request.user)
    streak.update_streak()
    
    return render(request, "home.html", {
        'aura_points': aura.aura_points, 
        'verification_status': verification_status,
        'streak_days': streak.current_streak,
        'longest_streak': streak.longest_streak,
    })


@login_required(login_url="signin")
def profile_view(request, user_id=None):
    # If user_id is provided, get that user's profile, otherwise show the current user's profile
    if user_id:
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            messages.error(request, "User not found!")
            return redirect("home")
    else:
        user = request.user
    
    connection_with = user
    # Get or create aura points
    aura, created = models.AuraPoints.objects.get_or_create(user=user)
    # print(f"created = {created}")
    # Calculate average rating
    ratings_stats = models.RatingPoints.objects.filter(given_to=user).aggregate(
        avg_rating=Avg('rate_points'),
        total_ratings=Count('id')
    )
    #
    verification = models.IdentityVerification.objects.filter(user=user).first()
    if verification:
        verification_status = verification.verification_status
        # print(verification_status)
    else:
        # print("No verification record found.")
        verification_status = "Unverified"
    # Get total connections
    total_connections = models.Connection.objects.filter(user = user and connection_with).count()
    
    # Get list of connected users
    user_connections = models.Connection.objects.filter(user=user).values_list('connection_with', flat=True)
    connected_users_list = User.objects.filter(id__in=user_connections)
    
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
        'verification_status': verification_status,
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
    return render(request, "signup.html", {"form": form})


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
    return render(request, "signin.html", {"form": form})


def logout_view(request):
    """
    Use as a POST action (your base.html already shows a POST form).
    """
    if request.method == "POST":
        logout(request)
        messages.info(request, "You have been signed out.")
    return redirect("landing")


@login_required(login_url="signin")
def identity_verification(request):
    """
    View to handle identity verification process.
    Users can submit their identity documents for verification.
    """
    from .forms import IdentityVerificationForm

    # Check if user already has a verification record
    existing_verification = models.IdentityVerification.objects.filter(user=request.user).first()

    if request.method == "POST":
        # If user already has verification, update it; otherwise create new
        if existing_verification:
            form = IdentityVerificationForm(request.POST, request.FILES, instance=existing_verification)
        else:
            form = IdentityVerificationForm(request.POST, request.FILES)

        if form.is_valid():
            verification = form.save(commit=False)
            verification.user = request.user
            # Reset status to PENDING when resubmitting
            verification.verification_status = models.IdentityVerification.VerificationStatus.PENDING
            verification.save()
            messages.success(request, "Your identity verification has been submitted successfully! We'll review it shortly.")
            return redirect("profile")
        else:
            messages.error(request, "Please fix the errors below and try again.")
    else:
        # If user has existing verification, pre-populate the form
        if existing_verification:
            form = IdentityVerificationForm(instance=existing_verification)
        else:
            form = IdentityVerificationForm()

    context = {
        'form': form,
        'existing_verification': existing_verification,
    }
    return render(request, "identity_verification.html", context)