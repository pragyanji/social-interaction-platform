from __future__ import annotations

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q, Sum, UniqueConstraint, CheckConstraint
from django.utils import timezone



# -----------------------------
# User
# -----------------------------
class User(AbstractUser):
    """
    Custom user that keeps your extra fields seen in the ERD.
    Username + password are inherited from AbstractUser.
    """
    full_name = models.CharField(max_length=150, blank=True)
    profile_pic = models.ImageField(upload_to="profiles/", blank=True, null=True)

    def __str__(self) -> str:
        return self.username


# -----------------------------
# Identity Verification
# -----------------------------
class IdentityVerification(models.Model):
    class DocumentType(models.TextChoices):
        NATIONAL_ID = "NATIONAL_ID", "National ID"
        PASSPORT = "PASSPORT", "Passport"
        DRIVERS_LICENSE = "DRIVERS_LICENSE", "Driver’s License"
        OTHER = "OTHER", "Other"

    class VerificationStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        VERIFIED = "VERIFIED", "Verified"
        REJECTED = "REJECTED", "Rejected"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="identity_verification"
    )
    document_type = models.CharField(max_length=32, choices=DocumentType.choices)
    document_pic = models.ImageField(upload_to="id_docs/")
    verification_status = models.CharField(
        max_length=20, choices=VerificationStatus.choices, default=VerificationStatus.PENDING
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.user} - {self.verification_status}"

    class Meta:
        verbose_name = "Identity verification"
        verbose_name_plural = "Identity verifications"
        


# -----------------------------
# Connections (user ↔ user)
# -----------------------------
class Connection(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="connections"
    )
    connection_with = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="connected_by"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # verified = models.OneToOneField(IdentityVerification, on_delete=models.SET_NULL, null=True, blank=True)       
    def clean(self):
        # Prevent self-connection
        if self.user_id == self.connection_with_id:
            raise ValidationError("You cannot connect to yourself.")

    class Meta:
        constraints = [
            # Each pair can appear only once regardless of order
            models.UniqueConstraint(
                fields=["user", "connection_with"], name="uniq_user_connection"
            ),
            models.CheckConstraint(
                check=~Q(user=models.F("connection_with")), name="no_self_connection"
            ),
        ]
        indexes = [
            models.Index(fields=["user", "connection_with"]),
            models.Index(fields=["connection_with"]),
        ]

    def __str__(self) -> str:
        return f"{self.user} ↔ {self.connection_with}"


# -----------------------------
# Conversations (messages between users)
# -----------------------------
class ConversationMessage(models.Model):
    """
    Your ERD shows 'Conversations' with conv_message, user_id, conv_with.
    Model each row as a message between two users.
    """
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_messages"
    )
    receiver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="received_messages"
    )
    conv_message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["sender", "receiver", "created_at"]),
            models.Index(fields=["receiver", "created_at"]),
        ]
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"MSG {self.id} {self.sender} → {self.receiver}"


# -----------------------------
# Rating points (user gives rating to another user)
# -----------------------------
class RatingPoints(models.Model):
    """
    The ERD has 'gives' (User → Rating_points) and a user_id inside Rating_points.
    To be explicit, we store both the rater (given_by) and the person being rated (given_to).
    """
    given_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ratings_given"
    )
    given_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ratings_received"
    )
    rate_points = models.IntegerField()  # allow negative/positive if needed
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["given_to", "created_at"]),
            models.Index(fields=["given_by", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"Rating {self.rate_points} to {self.given_to} by {self.given_by}"


# -----------------------------
# Aura points (denormalized sum; calculated from ratings)
# -----------------------------
class AuraPoints(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="aura"
    )
    aura_points = models.IntegerField(default=0)
    # Optional: last rating that triggered this calc (seen in ERD as rate_id)
    last_rating = models.ForeignKey(
        "RatingPoints", null=True, blank=True, on_delete=models.SET_NULL, related_name="aura_updates"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Aura points"
        verbose_name_plural = "Aura points"

    def recalc(self) -> int:
        total = (
            RatingPoints.objects.filter(given_to=self.user).aggregate(s=Sum("rate_points"))["s"]
            or 0
        )
        self.aura_points = total
        self.save(update_fields=["aura_points", "updated_at"])
        # keep the cached copy on User in sync (your ERD shows aura_point on User)
        User.objects.filter(pk=self.user_id).update(aura_point=total)
        return total

    def __str__(self) -> str:
        return f"Aura of {self.user}: {self.aura_points}"


# -----------------------------
# Reports
# -----------------------------
class Report(models.Model):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        UNDER_REVIEW = "UNDER_REVIEW", "Under Review"
        CLOSED = "CLOSED", "Closed"
        REJECTED = "REJECTED", "Rejected"

    user = models.ForeignKey(  # reporter
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports_made"
    )
    reported_to = models.ForeignKey(  # who is being reported
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports_received"
    )
    report_desc = models.TextField()
    report_status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["reported_to", "report_status"]),
            models.Index(fields=["user", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"Report {self.id} {self.user} → {self.reported_to} ({self.report_status})"


# -----------------------------
# Banned accounts
# -----------------------------
class BannedAcc(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ban"
    )
    banned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="bans_issued"
    )
    banned_reason = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Banned account"
        verbose_name_plural = "Banned accounts"
        indexes = [models.Index(fields=["active", "created_at"])]

    def __str__(self) -> str:
        state = "active" if self.active else "inactive"
        return f"Ban<{self.user} - {state}>"


# -----------------------------
# Daily Streak (tracks consecutive days of activity)
# -----------------------------
class DailyStreak(models.Model):
    """
    Tracks the daily streak for users.
    A user maintains a streak by visiting/interacting with the app on consecutive days.
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="daily_streak"
    )
    current_streak = models.IntegerField(default=0)
    longest_streak = models.IntegerField(default=0)
    last_visit_date = models.DateField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Daily streak"
        verbose_name_plural = "Daily streaks"

    def __str__(self) -> str:
        return f"{self.user} - Streak: {self.current_streak} days (Best: {self.longest_streak})"

    def update_streak(self):
        """
        Updates the daily streak for the user.
        Called when user visits the app.
        """
        from datetime import timedelta
        today = timezone.now().date()
        
        if self.last_visit_date is None:
            # First visit
            self.current_streak = 1
            self.longest_streak = 1
            self.last_visit_date = today
        elif self.last_visit_date == today:
            # Already visited today, no change
            pass
        elif self.last_visit_date == today - timedelta(days=1):
            # Consecutive day, increment streak
            self.current_streak += 1
            if self.current_streak > self.longest_streak:
                self.longest_streak = self.current_streak
            self.last_visit_date = today
        else:
            # Streak broken, start new streak
            self.current_streak = 1
            self.last_visit_date = today
        
        self.save()



