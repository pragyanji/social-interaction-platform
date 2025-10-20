# Social Interaction Platform

A Django-based social platform with real-time video chat capabilities using WebRTC and Firebase.

## Prerequisites

- Python 3.11 or higher
- Node.js and npm
- Git
- A Firebase account for video chat functionality

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/pragyanji/social-interaction-platform.git
cd social-interaction-platform
```

### 2. Set Up Python Environment

```bash
# Create a virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt
```

### 3. Install Node.js Dependencies

```bash
npm install
```

### 4. Configure Firebase

1. Copy the template configuration file:
```bash
cp core_chatsphere/video_chat_config.template.py core_chatsphere/video_chat_config.py
```

2. Set up Firebase:
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project
   - Enable Realtime Database
   - Get your project credentials
   - Update `video_chat_config.py` with your Firebase credentials

### 5. Database Setup

```bash
python manage.py migrate
```

### 6. Run the Development Server

```bash
python manage.py runserver
```

The application will be available at `http://localhost:8000`

## Development Workflow

1. Always create a new branch for your features:
```bash
git checkout -b feature/your-feature-name
```

2. Make your changes and commit them:
```bash
git add .
git commit -m "Descriptive commit message"
```

3. Push your changes:
```bash
git push origin feature/your-feature-name
```

4. Create a Pull Request from your branch to main

## Important Notes

- Never commit `video_chat_config.py` - it contains sensitive information
- Always keep your dependencies updated
- Follow the project's coding style and conventions
- Write tests for new features when possible

## Project Structure

```
social-interaction-platform/
├── chatsphere/            # Main Django project directory
├── core_chatsphere/       # Main application directory
├── templates/             # HTML templates
├── static/               # Static files (CSS, JS, images)
├── media/                # User-uploaded files
└── manage.py            # Django management script
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Troubleshooting

If you encounter any issues:

1. Ensure all dependencies are installed correctly
2. Check if Firebase configuration is set up properly
3. Make sure you're using the correct Python and Node.js versions
4. Check if your virtual environment is activated

## Security

- Keep your Firebase credentials private
- Never commit sensitive information
- Use environment variables for sensitive data
- Keep your dependencies updated

## Contact

For any questions or issues, please contact the project maintainer or create an issue in the repository.