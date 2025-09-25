from __future__ import annotations

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model, login, logout, authenticate
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.shortcuts import render, redirect, resolve_url
from django.utils.http import url_has_allowed_host_and_scheme

from .models import AuraPoints

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


# ---------- Views ----------
def landing_page(request):
    return render(request, "landing.html")


@login_required(login_url="signin")
def home(request):
    return render(request, "home.html")


def signup_view(request):
    if request.method == "POST":
        form = SignupForm(request.POST, request.FILES)
        if form.is_valid():
            user = form.save()
            AuraPoints.objects.get_or_create(user=user)

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
