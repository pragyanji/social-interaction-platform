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
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["sender", "receiver", "created_at"]),
            models.Index(fields=["receiver", "created_at"]),
            models.Index(fields=["receiver", "is_read"]),
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
    class Rating(models.IntegerChoices):
        VERY_POOR = 1, '1'
        POOR      = 2, '2'
        AVERAGE   = 3, '3'
        GOOD      = 4, '4'
        EXCELLENT = 5, '5'
    rate_points = models.IntegerField(choices=Rating.choices)  # Set the limit in application logic (e.g., 1-5)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["given_to", "created_at"]),
            models.Index(fields=["given_by", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"Rating {self.rate_points} to {self.given_to} by {self.given_by}"


# -----------------------------
# Aura points (denormalized sum; calculated from ratings, streaks, and reports)
# -----------------------------
class AuraPoints(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="aura")

    # Cached component values (for performance optimization)
    rating_component = models.IntegerField(default=0, help_text="Points from star ratings")
    streak_component = models.IntegerField(default=0, help_text="Points from daily streak")
    report_penalty = models.IntegerField(default=0, help_text="Negative points from reports")

    # Total Aura Points = rating_component + streak_component - report_penalty
    aura_points = models.IntegerField(default=0, help_text="Total calculated Aura Points")

    # Metadata for recalculation strategy
    last_rating = models.ForeignKey(
        "RatingPoints", null=True, blank=True, on_delete=models.SET_NULL, related_name="aura_updates"
    )
    last_recalculated = models.DateTimeField(null=True, blank=True, help_text="When components were last recalculated")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Aura points"
        verbose_name_plural = "Aura points"

    def recalc(self) -> int:
        """
        Recalculate Aura Points using the complete formula:

        Total Aura = (Rating Component) + (Streak Component) + (Verified Bonus) - (Report Penalty)

        Where:
        - Rating Component = Σ(star_rating × point_value) for all ratings received
          5★: +50, 4★: +30, 3★: +15, 2★: +5, 1★: -5
        - Streak Component = current_streak × 5 points per day
        - Verified Bonus = 50 points if user is verified
        - Report Penalty = report_count × 50 points
        """
        # Rating component: weighted sum by star rating
        RATING_WEIGHTS = {
            5: 50,   # 5-star ratings
            4: 30,   # 4-star ratings
            3: 15,   # 3-star ratings
            2: 5,    # 2-star ratings
            1: -5,   # 1-star ratings
        }

        rating_component = 0
        for stars, weight in RATING_WEIGHTS.items():
            count = RatingPoints.objects.filter(
                given_to=self.user, rate_points=stars
            ).count()
            rating_component += count * weight

        # Streak component: daily streak × 5 points per day
        streak_component = 0
        try:
            from core_chatsphere.models import DailyStreak
            daily_streak = DailyStreak.objects.get(user=self.user)
            streak_component = daily_streak.current_streak * 5
        except DailyStreak.DoesNotExist:
            streak_component = 0

        # Report penalty: count of reports × 50 points
        report_count = Report.objects.filter(reported_to=self.user).count()
        report_penalty = report_count * 50

        # Verified bonus: 50 points if user is verified
        verified_bonus = 0
        try:
            verification = IdentityVerification.objects.get(user=self.user)
            if verification.verification_status == IdentityVerification.VerificationStatus.VERIFIED:
                verified_bonus = 50
        except IdentityVerification.DoesNotExist:
            verified_bonus = 0

        # Calculate total (minimum 0, cannot go negative)
        total = max(0, rating_component + streak_component + verified_bonus - report_penalty)

        # Update all components
        self.rating_component = rating_component
        self.streak_component = streak_component
        self.report_penalty = report_penalty
        self.aura_points = total
        self.last_recalculated = timezone.now()
        self.save(update_fields=[
            "rating_component", "streak_component", "report_penalty",
            "aura_points", "last_recalculated", "updated_at"
        ])

        return total

    def __str__(self) -> str:
        return f"Aura of {self.user}: {self.aura_points} (R:{self.rating_component} S:{self.streak_component} V:0 P:{self.report_penalty})"


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
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ban")
    banned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="bans_issued")
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