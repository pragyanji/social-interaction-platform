/**
 * WebSocket client for real-time messaging
 * Handles connection, message sending/receiving, and read receipts
 */

class MessagingClient {
    constructor(userId, currentUserId, getCsrfToken) {
        this.userId = userId;
        this.currentUserId = parseInt(currentUserId);
        this.getCsrfToken = getCsrfToken;
        this.ws = null;
        this.wsUrl = null;
        this.isConnecting = false;
        this.messageQueue = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
    }

    /**
     * Initialize WebSocket connection and load message history
     */
    async init() {
        // Load message history from API
        await this.loadMessageHistory();
        // Connect to WebSocket
        this.connect();
    }

    /**
     * Load message history from REST API
     */
    async loadMessageHistory() {
        try {
            const response = await fetch(`/api/messages/${this.userId}/`);
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.messages) {
                    // Display previous messages (normalize API field names to match WebSocket format)
                    data.messages.forEach(msg => {
                        this.displayMessage({
                            message_id: msg.id,
                            sender_id: msg.sender,
                            receiver_id: msg.receiver,
                            message: msg.conv_message,
                            created_at: msg.created_at,
                            is_read: msg.is_read,
                        });
                    });
                    // Scroll to bottom
                    this.scrollToBottom();
                    // Mark messages as read
                    this.markMessagesAsRead();
                }
            }
        } catch (error) {
            console.error('Error loading message history:', error);
        }
    }

    /**
     * Connect to WebSocket
     */
    connect() {
        if (this.isConnecting || this.ws) {
            return;
        }

        this.isConnecting = true;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.wsUrl = `${protocol}//${window.location.host}/ws/chat/${this.userId}/`;

        try {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.onopen = (event) => this.onOpen(event);
            this.ws.onmessage = (event) => this.onMessage(event);
            this.ws.onclose = (event) => this.onClose(event);
            this.ws.onerror = (event) => this.onError(event);
        } catch (error) {
            console.error('WebSocket connection error:', error);
            this.isConnecting = false;
            this.scheduleReconnect();
        }
    }

    /**
     * Handle WebSocket open event
     */
    onOpen(event) {
        console.log('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // Send any queued messages
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            this.sendMessage(message);
        }
    }

    /**
     * Handle incoming WebSocket messages
     */
    onMessage(event) {
        try {
            const data = JSON.parse(event.data);

            if (data.type === 'chat_message') {
                this.handleChatMessage(data);
            } else if (data.type === 'message_read') {
                this.handleMessageRead(data);
            } else if (data.type === 'user_presence') {
                this.handleUserPresence(data);
            } else if (data.type === 'error') {
                console.error('WebSocket error:', data.message);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    }

    /**
     * Handle WebSocket close event
     */
    onClose(event) {
        console.log('WebSocket closed');
        this.isConnecting = false;
        this.updateConnectionStatus(false);

        if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
        }
    }

    /**
     * Handle WebSocket error event
     */
    onError(event) {
        console.error('WebSocket error:', event);
        this.updateConnectionStatus(false);
    }

    /**
     * Schedule WebSocket reconnection with exponential backoff
     */
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            return;
        }

        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;

        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => this.connect(), delay);
    }

    /**
     * Send a message through WebSocket
     */
    send(message) {
        if (!message.trim()) {
            return;
        }

        const payload = {
            type: 'chat_message',
            message: message
        };

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        } else {
            // Queue message if not connected
            this.messageQueue.push(message);
            console.warn('WebSocket not connected. Message queued.');
        }
    }

    /**
     * Handle incoming chat message
     */
    handleChatMessage(data) {
        this.displayMessage(data);
        this.scrollToBottom();

        // Mark message as read if we're the receiver
        if (data.receiver_id === this.currentUserId && !data.is_read) {
            this.markMessageAsRead(data.message_id);
        }
    }

    /**
     * Handle message read receipt
     */
    handleMessageRead(data) {
        const messageEl = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (messageEl) {
            const readEl = messageEl.querySelector('.message-read-status');
            if (readEl) {
                readEl.textContent = '✓✓';
                messageEl.classList.add('message-read');
            }
        }
    }

    /**
     * Handle user presence (online/offline) updates
     */
    handleUserPresence(data) {
        // Only update the indicator for the OTHER user, not ourselves
        if (data.user_id !== this.currentUserId) {
            this.updateConnectionStatus(data.status === 'online');
        }
    }

    /**
     * Display a message in the chat area
     */
    displayMessage(msg) {
        const messagesContainer = document.querySelector('.chat-messages');
        if (!messagesContainer) {
            return;
        }

        // Check if message already exists
        if (document.querySelector(`[data-message-id="${msg.message_id}"]`)) {
            return;
        }

        const isSent = msg.sender_id === this.currentUserId;

        const groupEl = document.createElement('div');
        groupEl.className = 'message-group';
        groupEl.setAttribute('data-message-id', msg.message_id);

        const bubbleEl = document.createElement('div');
        bubbleEl.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
        bubbleEl.textContent = msg.message;

        // Format timestamp
        const timestamp = new Date(msg.created_at).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let readStatusHtml = '';
        if (isSent) {
            readStatusHtml = ` <span class="message-read-status">${msg.is_read ? '✓✓' : '✓'}</span>`;
        }

        const timestampEl = document.createElement('div');
        timestampEl.className = `message-timestamp${isSent ? '' : ' received'}`;
        timestampEl.innerHTML = `${timestamp}${readStatusHtml}`;

        groupEl.appendChild(bubbleEl);
        groupEl.appendChild(timestampEl);
        messagesContainer.appendChild(groupEl);
    }

    /**
     * Mark message as read
     */
    markMessageAsRead(messageId) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        const payload = {
            type: 'mark_as_read',
            message_id: messageId
        };

        this.ws.send(JSON.stringify(payload));
    }

    /**
     * Mark all messages from other user as read (API call)
     */
    async markMessagesAsRead() {
        try {
            const response = await fetch(`/api/messages/${this.userId}/read/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCsrfToken()
                },
                body: JSON.stringify({})
            });

            if (response.ok) {
                const data = await response.json();
                console.log(`Marked ${data.marked_as_read} messages as read`);
                // Clear the unread badge for this user in the sidebar
                const userItem = document.querySelector(`.sidebar-item[data-user-id="${this.userId}"]`);
                if (userItem) {
                    const badge = userItem.querySelector('.unread-badge');
                    if (badge) badge.remove();
                }
            }
        } catch (error) {
            console.error('Error marking messages as read:', error);
        }
    }

    /**
     * Scroll chat area to bottom
     */
    scrollToBottom() {
        const messagesContainer = document.querySelector('.chat-messages');
        if (messagesContainer) {
            setTimeout(() => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 0);
        }
    }

    /**
     * Update connection status indicator
     */
    updateConnectionStatus(isConnected) {
        const statusEl = document.querySelector('.connection-status');
        const dotEl = document.querySelector('.header-status-dot');

        if (statusEl) {
            statusEl.classList.toggle('online', isConnected);
            statusEl.classList.toggle('disconnected', !isConnected);
            statusEl.textContent = isConnected ? 'Online' : 'Offline';
        }

        if (dotEl) {
            dotEl.classList.toggle('online', isConnected);
        }
    }

    /**
     * Escape HTML special characters to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Close WebSocket connection
     */
    close() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

/**
 * Initialize messaging when DOM is ready
 */
document.addEventListener('DOMContentLoaded', function () {
    const selectedUserElement = document.querySelector('[data-selected-user-id]');
    const currentUserElement = document.querySelector('[data-current-user-id]');

    if (!selectedUserElement || !currentUserElement) {
        console.log('Message chat not initialized - required data attributes missing');
        return;
    }

    const selectedUserId = selectedUserElement.getAttribute('data-selected-user-id');
    const currentUserId = currentUserElement.getAttribute('data-current-user-id');

    if (!selectedUserId || !currentUserId) {
        console.log('Message chat not initialized - no user selected');
        return;
    }

    // Get CSRF token from DOM
    const getCsrfToken = () => {
        return document.querySelector('[name="csrfmiddlewaretoken"]')?.value ||
            document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
            '';
    };

    // Initialize messaging client
    const client = new MessagingClient(selectedUserId, currentUserId, getCsrfToken);
    client.init();

    // Handle message input
    const messageInput = document.querySelector('.message-input');
    const sendButton = document.querySelector('.send-btn');

    if (messageInput && sendButton) {
        const sendMessage = () => {
            const message = messageInput.value.trim();
            if (message) {
                client.send(message);
                messageInput.value = '';
                messageInput.focus();
            }
        };

        sendButton.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // Store client reference globally for debugging
    window.messagingClient = client;
});
