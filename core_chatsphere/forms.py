from __future__ import annotations

from django import forms
from .models import IdentityVerification


class IdentityVerificationForm(forms.ModelForm):
    """
    Form for users to submit identity verification documents.
    """
    class Meta:
        model = IdentityVerification
        fields = ['document_type', 'document_pic']
        widgets = {
            'document_type': forms.Select(attrs={
                'class': 'w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500',
            }),
            'document_pic': forms.FileInput(attrs={
                'class': 'w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500',
                'accept': 'image/*,.pdf',
            }),
        }
        labels = {
            'document_type': 'Document Type',
            'document_pic': 'Upload Document',
        }
        help_texts = {
            'document_pic': 'Please upload a clear image or PDF of your identity document (max 5MB).',
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Make all fields required
        for field in self.fields:
            self.fields[field].required = True
