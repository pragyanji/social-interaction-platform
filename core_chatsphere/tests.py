from django.test import TestCase, Client
from django.contrib.auth import get_user_model
from django.urls import reverse
from better_profanity import profanity
from .models import Notification, ModerationLog, BannedAcc, AuraPoints

User = get_user_model()

class ContentModerationTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="testuser", password="password123")
        self.client = Client()

    def test_profanity_censorship(self):
        """Test that better-profanity correctly censors English, Hindi, and Nepali words."""
        from .profanity_words import NEPALI_HINDI_PROFANITY
        profanity.load_censor_words()
        profanity.add_censor_words(NEPALI_HINDI_PROFANITY)
        
        # Test English
        text_en = "This is a bad shit word."
        censored_en = profanity.censor(text_en)
        self.assertIn("****", censored_en)
        self.assertNotIn("shit", censored_en)

        # Test Hindi Roman
        text_hi = "kya haal hai saala chutiya"
        censored_hi = profanity.censor(text_hi)
        self.assertIn("****", censored_hi)
        self.assertNotIn("chutiya", censored_hi)

        # Test Nepali Roman
        text_ne = "yo muji chikne daka"
        censored_ne = profanity.censor(text_ne)
        self.assertIn("****", censored_ne)
        self.assertNotIn("muji", censored_ne)

    def test_notification_creation(self):
        """Test that notification model saves correctly."""
        notif = Notification.objects.create(
            user=self.user,
            title="Warning strike 1",
            message="Nudity was detected in your live feed."
        )
        self.assertEqual(notif.title, "Warning strike 1")
        self.assertFalse(notif.is_read)

    def test_banned_user_middleware(self):
        """Test that banned users are blocked by BannedUserMiddleware and redirected."""
        self.client.login(username="testuser", password="password123")
        
        # Initially user should be able to access home
        response = self.client.get(reverse("home"))
        self.assertEqual(response.status_code, 200)

        # Now, ban the user
        BannedAcc.objects.create(
            user=self.user,
            banned_reason="Explicit content",
            active=True
        )

        # Accessing home should redirect to banned page
        response = self.client.get(reverse("home"))
        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse("banned_view"), response["Location"])

        # Accessing banned page itself should return 200 (no circular redirect)
        response = self.client.get(reverse("banned_view"))
        self.assertEqual(response.status_code, 200)

    def test_daily_rating_and_reporting_limits(self):
        """Test that rating and reporting a stranger is limited to once per day."""
        stranger = User.objects.create_user(username="stranger", password="password123")
        self.client.login(username="testuser", password="password123")

        # 1. Test Daily Rating Limit
        # First rating should succeed
        response = self.client.post(
            reverse("submit_rating"),
            data={"rated_user_id": stranger.id, "rate_points": 5},
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])

        # Second rating on the same day should fail
        response = self.client.post(
            reverse("submit_rating"),
            data={"rated_user_id": stranger.id, "rate_points": 4},
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()["success"])
        self.assertIn("already rated", response.json()["error"])

        # 2. Test Daily Reporting Limit
        # First report should succeed
        response = self.client.post(
            reverse("report_user"),
            data={
                "room_id": "testroom123",
                "reported_user_id": stranger.id,
                "reason": "Harassment",
                "description": "User was inappropriate"
            },
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])

        # Second report on the same day should fail
        response = self.client.post(
            reverse("report_user"),
            data={
                "room_id": "testroom123",
                "reported_user_id": stranger.id,
                "reason": "Spam",
                "description": "User keeps repeating"
            },
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()["success"])
        self.assertIn("already reported", response.json()["error"])

    def test_notification_deletion(self):
        """Test that single and bulk notification deletions work properly."""
        # Create notifications
        notif1 = Notification.objects.create(user=self.user, title="Alert 1", message="Msg 1")
        notif2 = Notification.objects.create(user=self.user, title="Alert 2", message="Msg 2")
        
        self.client.login(username="testuser", password="password123")
        
        # Delete single notification
        response = self.client.post(
            reverse("delete_notification", kwargs={"notif_id": notif1.id})
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "success")
        
        # Verify notif1 is deleted, but notif2 still exists
        self.assertFalse(Notification.objects.filter(id=notif1.id).exists())
        self.assertTrue(Notification.objects.filter(id=notif2.id).exists())
        
        # Delete all notifications
        response = self.client.post(reverse("delete_all_notifications"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "success")
        
        # Verify both are deleted
        self.assertFalse(Notification.objects.filter(user=self.user).exists())


