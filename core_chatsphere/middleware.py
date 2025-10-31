class LoggingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Process the request without logging
        response = self.get_response(request)
        return response
    
    # Commented out verbose logging - uncomment if needed for debugging
    # def __call__(self, request):
    #     # Log request details
    #     print(f"\n=== Request: {request.method} {request.path} ===")
    #     print("Headers:", dict(request.headers))
        
    #     # Safely get user info
    #     user_info = "Anonymous"
    #     if hasattr(request, 'user') and request.user:
    #         user_info = f"{request.user} (id: {getattr(request.user, 'id', 'N/A')})"
    #     print("User:", user_info)
        
    #     # Safely check authentication
    #     is_authenticated = getattr(request.user, 'is_authenticated', False)
    #     print("Authenticated:", is_authenticated)
        
    #     # Safely get session info
    #     session_info = {}
    #     if hasattr(request, 'session'):
    #         session_info = dict(request.session)
    #     print("Session:", session_info)
        
    #     # Process the request
    #     response = self.get_response(request)
        
    #     # Log response details
    #     print(f"=== Response: {response.status_code} ===")
    #     print("Content Type:", response.get('Content-Type', 'unknown'))
        
    #     # Only print response headers if they exist
    #     if hasattr(response, 'items'):
    #         print("Headers:", dict(response.items()))
        
    #     return response
