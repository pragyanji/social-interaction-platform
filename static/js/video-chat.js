// Firebase Setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getDatabase, ref, set, get, onValue, push, remove, update, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// Debug flag - set to true to see detailed logs
const DEBUG = true;

// Debug function
function log(...args) {
    if (DEBUG) {
        console.log('[ChatSphere]', ...args);
    }
}

// DOM Elements
let startButton, stopButton, nextButton, homeButton, connectButton, reportButton, rateButton, localVideo, remoteVideo, statusEl, videoContainer, loadingSpinner, onlineCountEl, waitingUsersEl;
let reportModal, reportForm, reportSuccess, closeModalBtn, cancelReportBtn, closeSuccessModalBtn;
let ratingModal, ratingForm, ratingSuccess, closeRatingModalBtn, cancelRatingBtn, closeRatingSuccessModalBtn, selectedRatingValue;
let connectModal, connectForm, connectSuccess, closeConnectModalBtn, confirmConnectBtn, cancelConnectBtn, closeConnectSuccessModalBtn;

// Helper function to get CSRF token with better error handling
function getCsrfToken() {
    try {
        const cookieValue = document.cookie
            .split('; ')
            .find(row => row.startsWith('csrftoken='))
            ?.split('=')[1];

        if (!cookieValue) {
            console.error('CSRF token not found in cookies. Available cookies:', document.cookie);
            throw new Error('Authentication error. Please refresh the page and try again.');
        }
        return cookieValue;
    } catch (error) {
        console.error('Error getting CSRF token:', error);
        throw new Error('Authentication error. Please refresh the page and try again.');
    }
}

// Helper function to get CSRF token
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

// Initialize Firebase globally
let app, db, auth;
try {
    log('Loading Firebase config from global variable');
    const firebaseConfig = window.FIREBASE_CONFIG;
    log('Firebase config loaded:', firebaseConfig);

    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    auth = getAuth(app);

    log('Firebase initialized successfully');
} catch (error) {
    console.error('Error initializing Firebase:', error);
    log('Firebase initialization failed:', error.message);
    throw error;
}

// WebRTC Configuration
async function checkMediaPermissions() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log('Media permissions granted:', stream.getTracks());
        stream.getTracks().forEach(track => track.stop());
        document.getElementById('status').textContent = 'Camera and microphone access granted';
        return true;
    } catch (error) {
        console.error('Media permission error:', error);
        document.getElementById('status').textContent = 'Error: ' + error.message;
        return false;
    }
}

const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    ],
    iceCandidatePoolSize: 10,
};
let pc = new RTCPeerConnection(servers);

// App State
let localStream = null;
let remoteStream = null;
let currentRoomId = null;
let userId = null;
let djangoUserId = window.DJANGO_USER_ID || ""; // Get from window variable
let peerDjangoUserId = null; // Store peer's Django user ID
let isAudioEnabled = true;
let isVideoEnabled = true;
let roomListener = null; // To track room status changes
let isReconnecting = false; // Flag to prevent infinite reconnection loops

// Debug: Check if Django user ID is set
log('Django User ID:', djangoUserId);

function updateStatus(message, isError = false) {
    console.log(message);
    statusEl.textContent = message;
    if (isError) {
        statusEl.classList.add('text-red-500');
    } else {
        statusEl.classList.remove('text-red-500');
    }
}

// Function to start the chat
async function startChat() {
    log('Start button clicked');
    try {
        // Validate user is authenticated
        if (!userId) {
            throw new Error('Not authenticated. Please wait for authentication or refresh the page.');
        }

        log('Disabling start button');
        startButton.disabled = true;
        updateStatus('Starting video chat...');

        log('Setting up media streams');
        await setupStreams();

        log('Finding or creating room');
        await findOrCreateRoom();
    } catch (error) {
        console.error('Error starting chat:', error);
        console.error('Error stack:', error.stack);
        startButton.disabled = false;

        // Show the header again if it was hidden
        const chatHeader = document.getElementById('chat-header');
        if (chatHeader) {
            chatHeader.classList.remove('hidden');
        }

        updateStatus('Failed to start chat: ' + error.message, true);
    }
}

// Add connection state listener
pc.onconnectionstatechange = (event) => {
    console.log("Connection state changed:", pc.connectionState);
    updateStatus("WebRTC Connection State: " + pc.connectionState);
};

// Add ICE connection state listener
pc.oniceconnectionstatechange = (event) => {
    console.log("ICE Connection state:", pc.iceConnectionState);
    updateStatus("ICE Connection State: " + pc.iceConnectionState);
};

// Add signaling state listener
pc.onsignalingstatechange = (event) => {
    console.log("Signaling state:", pc.signalingState);
    updateStatus("Signaling State: " + pc.signalingState);
};

// Presence System Functions
async function setupPresence() {
    log('setupPresence called, userId:', userId);
    if (!userId) {
        log('setupPresence skipped: userId not set');
        return;
    }

    try {
        const presenceRef = ref(db, `presence/${userId}`);

        // Function to update presence
        async function updatePresence() {
            const userStatusData = {
                online: true,
                lastSeen: Date.now()
            };
            await set(presenceRef, userStatusData);
            log('Presence updated for user:', userId);
        }

        // Set initial presence
        await updatePresence();

        // Update presence every 30 seconds to show user is still active
        const presenceInterval = setInterval(updatePresence, 30000);

        // Store interval ID so we can clear it on cleanup
        window.presenceInterval = presenceInterval;

        // Remove user from presence when they disconnect
        onDisconnect(presenceRef).remove();

        // Also handle page visibility changes
        document.addEventListener('visibilitychange', async () => {
            if (document.hidden) {
                // User switched tabs or minimized window
                await update(presenceRef, { online: false, lastSeen: Date.now() });
            } else {
                // User came back
                await updatePresence();
            }
        });

        // Clean up on page unload
        window.addEventListener('beforeunload', () => {
            // Try to set offline (may not always work due to browser restrictions)
            navigator.sendBeacon && set(presenceRef, { online: false, lastSeen: Date.now() });
        });

        log('Presence tracking setup complete for user:', userId);
    } catch (error) {
        console.error('Error setting up presence:', error);
    }
}

function trackOnlineUsers() {
    log('Setting up online user tracking');
    const roomsRef = ref(db, 'rooms');
    const waitingRoomsRef = ref(db, 'waiting_rooms');

    // Function to count online users from rooms and waiting rooms
    async function updateOnlineCount() {
        try {
            const [roomsSnapshot, waitingSnapshot] = await Promise.all([
                get(roomsRef),
                get(waitingRoomsRef)
            ]);

            const rooms = roomsSnapshot.val();
            const waitingRooms = waitingSnapshot.val();
            const uniqueUsers = new Set();

            // Count users in active rooms (users currently in video chat)
            if (rooms) {
                Object.values(rooms).forEach(room => {
                    if (room.creatorId) uniqueUsers.add(room.creatorId);
                    if (room.joinerId) uniqueUsers.add(room.joinerId);
                });
            }

            // Count users waiting for a match
            if (waitingRooms) {
                Object.values(waitingRooms).forEach(room => {
                    if (room.creatorId) uniqueUsers.add(room.creatorId);
                });
            }

            const count = uniqueUsers.size;
            if (onlineCountEl) {
                onlineCountEl.textContent = count;
            }
            log('Online users count:', count, 'Unique UIDs:', Array.from(uniqueUsers));
        } catch (error) {
            console.error('Error updating online count:', error);
            if (onlineCountEl) {
                onlineCountEl.textContent = '0';
            }
        }
    }

    // Listen to changes in both rooms and waiting_rooms
    onValue(roomsRef, () => {
        log('Rooms changed, updating online count');
        updateOnlineCount();
    }, (error) => {
        console.error('Error listening to rooms:', error);
    });

    onValue(waitingRoomsRef, () => {
        log('Waiting rooms changed, updating online count');
        updateOnlineCount();
    }, (error) => {
        console.error('Error listening to waiting_rooms:', error);
    });

    // Initial count
    updateOnlineCount();
}

function trackWaitingUsers() {
    const waitingRoomsRef = ref(db, 'waiting_rooms');

    onValue(waitingRoomsRef, (snapshot) => {
        const waitingRooms = snapshot.val();
        const count = waitingRooms ? Object.keys(waitingRooms).length : 0;

        if (count > 0) {
            waitingUsersEl.textContent = `${count} ${count === 1 ? 'person' : 'people'} waiting to chat`;
        } else {
            waitingUsersEl.textContent = '';
        }
        log('Waiting users:', count);
    });
}

async function removePresence() {
    if (!userId) return;

    try {
        await remove(ref(db, `presence/${userId}`));
        log('User presence removed');
    } catch (error) {
        console.warn('Error removing presence:', error);
    }
}

// Monitor room for peer disconnection
function monitorRoomStatus() {
    if (!currentRoomId) return;

    const roomRef = ref(db, `rooms/${currentRoomId}`);

    // Remove previous listener if exists
    if (roomListener) {
        roomListener();
    }

    roomListener = onValue(roomRef, async (snapshot) => {
        const roomData = snapshot.val();

        // If room is deleted (peer clicked Next/Stop)
        if (!roomData && !isReconnecting) {
            log('Room deleted - peer has left');
            isReconnecting = true;
            updateStatus('Stranger has left. Finding a new partner...');

            // Stop listening
            if (roomListener) {
                roomListener();
                roomListener = null;
            }

            // Automatically find new partner
            const oldRoomId = currentRoomId;
            currentRoomId = null; // Clear room ID to prevent cleanup from deleting again

            // Clean up local resources only
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
            if (remoteStream) {
                remoteStream.getTracks().forEach(track => track.stop());
            }
            if (pc) {
                pc.close();
                pc = new RTCPeerConnection(servers);
            }

            try {
                await setupStreams();
                await findOrCreateRoom();
            } catch (error) {
                console.error('Error finding new chat after peer left:', error);
                updateStatus('Error finding new chat. Please try again.');
            } finally {
                isReconnecting = false;
            }
        }
    });

    log('Room monitoring started');
}

// Clean up all stale rooms and waiting rooms globally
async function cleanupAllStaleRooms() {
    log('Cleaning up all stale rooms...');
    try {
        const roomsRef = ref(db, 'rooms');
        const waitingRoomsRef = ref(db, 'waiting_rooms');
        const STALE_TIMEOUT = 120000; // 2 minutes (reduced from 5 minutes)
        const now = Date.now();

        // Clean up stale rooms
        const roomsSnapshot = await get(roomsRef);
        if (roomsSnapshot.exists()) {
            const rooms = roomsSnapshot.val();
            let cleanedCount = 0;

            for (const [roomId, room] of Object.entries(rooms)) {
                // Check if room has a createdAt timestamp
                if (room.createdAt && typeof room.createdAt === 'number') {
                    const roomAge = now - room.createdAt;
                    if (roomAge > STALE_TIMEOUT) {
                        log(`Removing stale room: ${roomId}, age: ${Math.round(roomAge / 1000)}s`);
                        await remove(ref(db, `rooms/${roomId}`));
                        cleanedCount++;
                    }
                } else if (!room.createdAt) {
                    // Remove rooms without timestamp (legacy data)
                    log(`Removing room without timestamp: ${roomId}`);
                    await remove(ref(db, `rooms/${roomId}`));
                    cleanedCount++;
                }
            }

            if (cleanedCount > 0) {
                log(`Cleaned up ${cleanedCount} stale rooms`);
            }
        }

        // Clean up stale waiting rooms
        const waitingSnapshot = await get(waitingRoomsRef);
        if (waitingSnapshot.exists()) {
            const waitingRooms = waitingSnapshot.val();
            let cleanedCount = 0;

            for (const [roomId, room] of Object.entries(waitingRooms)) {
                if (room.createdAt && typeof room.createdAt === 'number') {
                    const roomAge = now - room.createdAt;
                    if (roomAge > STALE_TIMEOUT) {
                        log(`Removing stale waiting room: ${roomId}, age: ${Math.round(roomAge / 1000)}s`);
                        await remove(ref(db, `waiting_rooms/${roomId}`));
                        cleanedCount++;
                    }
                } else if (!room.createdAt) {
                    // Remove waiting rooms without timestamp (legacy data)
                    log(`Removing waiting room without timestamp: ${roomId}`);
                    await remove(ref(db, `waiting_rooms/${roomId}`));
                    cleanedCount++;
                }
            }

            if (cleanedCount > 0) {
                log(`Cleaned up ${cleanedCount} stale waiting rooms`);
            }
        }

        log('Stale room cleanup complete');
    } catch (error) {
        console.error('Error cleaning up stale rooms:', error);
    }
}

async function initialize() {
    log('Initializing application');
    try {
        // Validate Firebase configuration
        if (!window.FIREBASE_CONFIG) {
            throw new Error('Firebase configuration not found');
        }

        log('Initializing Firebase');
        updateStatus("Initializing Firebase connection...");

        log('Signing in anonymously...');
        const userCredential = await signInAnonymously(auth);
        log('Anonymous auth successful. User UID:', userCredential.user.uid);
        updateStatus("Firebase initialized, authenticating...");
    } catch (error) {
        console.error("Authentication failed:", error);
        updateStatus("Error: Could not authenticate with Firebase. " + error.message, true);
        return;
    }

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            log('User authenticated. Firebase UID:', user.uid, '| Django User ID:', djangoUserId);
            userId = user.uid;

            // Debug: Check if multiple users have same UID (shouldn't happen)
            if (window.allUserIds === undefined) {
                window.allUserIds = new Set();
            }
            window.allUserIds.add(userId);
            log('Total unique Firebase UIDs in this session:', window.allUserIds.size);

            // Clean up stale rooms before starting tracking
            await cleanupAllStaleRooms();

            // Start tracking online users after cleanup
            log('Starting online user tracking...');
            trackOnlineUsers();
            trackWaitingUsers();

            startButton.disabled = false;
            startButton.classList.remove('opacity-50');
            updateStatus("Authentication successful. Click 'Start Chat' to begin.");

            // Setup presence tracking
            try {
                await setupPresence();
                log('Presence setup complete, user should now be visible in online count');
            } catch (error) {
                console.error('Error setting up presence:', error);
                // Don't fail the whole initialization if presence fails
            }
        } else {
            log('User not authenticated');
            userId = null;
            startButton.disabled = true;
            startButton.classList.add('opacity-50');
            updateStatus("Authentication required to start.", true);
        }
    });

    // Add manual check for Firebase config
    log('Firebase config loaded:', !!window.FIREBASE_CONFIG);
    log('Start button status:', !startButton.disabled);
}

const setupStreams = async () => {
    try {
        if (!statusEl) {
            throw new Error('Status element not found');
        }
        statusEl.textContent = "Setting up video chat...";
        // Hide the header when starting chat
        const chatHeader = document.getElementById('chat-header');
        if (chatHeader) {
            chatHeader.classList.add('hidden');
        }

        statusEl.textContent = "Requesting camera and microphone access...";
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        statusEl.textContent = "Camera and microphone access granted";
        remoteStream = new MediaStream();

        // Log device information
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log("Available devices:", devices);

        localStream.getTracks().forEach((track) => {
            pc.addTrack(track, localStream);
        });

        pc.ontrack = (event) => {
            event.streams[0].getTracks().forEach((track) => {
                remoteStream.addTrack(track);
            });
        };

        localVideo.srcObject = localStream;
        remoteVideo.srcObject = remoteStream;

        videoContainer.classList.remove('hidden');
        startButton.classList.add('hidden');
        homeButton.classList.add('hidden');
        nextButton.classList.remove('hidden');
        nextButton.disabled = false;
        stopButton.classList.remove('hidden');
        stopButton.disabled = false;
        reportButton.classList.remove('hidden');
        reportButton.disabled = false;
        rateButton.classList.remove('hidden');
        rateButton.disabled = false;

        // Only show connect button if it exists (for verified users)
        if (connectButton) {
            connectButton.classList.remove('hidden');
            connectButton.disabled = false;
        }

        // Enable/disable buttons
        startButton.disabled = true;
        nextButton.disabled = false;
        stopButton.disabled = false;
        reportButton.disabled = false;
    } catch (error) {
        console.error("Media Error:", error);
        switch(error.name) {
            case 'NotAllowedError':
                statusEl.textContent = "Camera/Microphone access denied. Please check your permissions.";
                break;
            case 'NotFoundError':
                statusEl.textContent = "No camera or microphone found. Please connect a device.";
                break;
            case 'NotReadableError':
                statusEl.textContent = "Camera/Microphone is already in use by another application.";
                break;
            default:
                statusEl.textContent = "Could not access camera/microphone. Please try again.";
        }
        throw error;
    }
};

// Helper function to clean up rooms
async function cleanupRooms() {
    console.log("Cleaning up existing rooms for user:", userId);
    const roomsRef = ref(db, 'rooms');
    const waitingRoomsRef = ref(db, 'waiting_rooms');

    // Clean rooms
    const existingRooms = await get(roomsRef);
    if (existingRooms.exists()) {
        const rooms = existingRooms.val();
        for (const [key, room] of Object.entries(rooms)) {
            if (room.creatorId === userId || room.joinerId === userId) {
                console.log("Removing existing room:", key);
                await remove(ref(db, `rooms/${key}`));
            }
        }
    }

    // Clean waiting rooms
    const existingWaitingRooms = await get(waitingRoomsRef);
    if (existingWaitingRooms.exists()) {
        const rooms = existingWaitingRooms.val();
        for (const [key, room] of Object.entries(rooms)) {
            if (room.creatorId === userId) {
                console.log("Removing existing waiting room:", key);
                await remove(ref(db, `waiting_rooms/${key}`));
            }
        }
    }
}

async function findOrCreateRoom() {
    try {
        statusEl.textContent = 'Looking for a stranger...';
        loadingSpinner.classList.remove('hidden');
        nextButton.disabled = true;

        // Validate Django user ID
        if (!djangoUserId || djangoUserId === 'None' || djangoUserId === '') {
            throw new Error('Django user ID not set. Please refresh and try again.');
        }

        log('Creating/joining room with Django user ID:', djangoUserId);

        const roomsRef = ref(db, 'rooms');
        const waitingRoomsRef = ref(db, 'waiting_rooms');

        // Try to find an existing room BEFORE cleaning up
        log('🔍 Fetching waiting rooms...');
        statusEl.textContent = 'Checking for available strangers...';
        const waitingRooms = await get(waitingRoomsRef);

        if (waitingRooms.exists()) {
            const rooms = waitingRooms.val();
            log("📋 Searching for available room. My userId:", userId);
            log("📋 Available waiting rooms:", JSON.stringify(rooms, null, 2));

            const availableRoom = Object.entries(rooms).find(([_, room]) => {
                const isAvailable = room.creatorId !== userId;
                log(`🔍 Room check: creatorId=${room.creatorId}, myId=${userId}, available=${isAvailable}`);
                return isAvailable;
            });

            if (availableRoom) {
                const [roomId, roomData] = availableRoom;
                log("✅ Found available room:", roomId, "Created by:", roomData.creatorId);
                statusEl.textContent = 'Found a stranger! Connecting...';
                currentRoomId = roomId;

                // Get the full room data from the main rooms collection
                log(`📡 Fetching main room data for ${roomId}...`);
                const existingRoomSnapshot = await get(ref(db, `rooms/${roomId}`));
                const existingRoomData = existingRoomSnapshot.val();
                log("📋 Main room data:", JSON.stringify(existingRoomData, null, 2));

                if (!existingRoomData) {
                    log("❌ Room data not found in main rooms collection");
                    throw new Error('Room data not found in main rooms collection. Room may have been closed.');
                }

                if (!existingRoomData.offer) {
                    log("❌ No offer found in room data");
                    throw new Error('No offer found in room. Peer may not be ready.');
                }

                // Store peer's Django user ID
                peerDjangoUserId = existingRoomData.creatorDjangoId;
                log("👤 Peer Django user ID:", peerDjangoUserId);

                if (!peerDjangoUserId) {
                    log("⚠️ Warning: Peer Django user ID not found in room data");
                } else {
                    // Load peer stats for tooltip display
                    loadPeerStats(peerDjangoUserId);
                }

                // Remove from waiting rooms and update status
                log(`🔄 Removing room ${roomId} from waiting_rooms...`);
                await remove(ref(db, `waiting_rooms/${roomId}`));

                log(`🔄 Updating room ${roomId} status to 'full'...`);
                await update(ref(db, `rooms/${roomId}`), {
                    status: 'full',
                    joinerId: userId,
                    joinerDjangoId: djangoUserId
                });

                log('✅ Successfully joined room. Starting as callee...');
                statusEl.textContent = 'Connecting to stranger...';
                await startCallAsCallee();
                return;
            } else {
                log("❌ No available rooms found (all rooms have same creator as me)");
            }
        } else {
            log("📭 No waiting rooms exist in database");
        }

        // No available rooms - cleanup old rooms and create a new one
        log('No available rooms found. Cleaning up old rooms for this user...');
        await cleanupRooms();

        log('Creating new room');
        const newRoomRef = push(roomsRef);
        currentRoomId = newRoomRef.key;

        const timestamp = Date.now();

        // First, create the WebRTC offer BEFORE adding to waiting rooms
        log('Creating WebRTC offer first...');
        const offerDescription = await pc.createOffer();
        await pc.setLocalDescription(offerDescription);
        log('Offer created:', offerDescription.type);

        const offer = {
            sdp: offerDescription.sdp,
            type: offerDescription.type,
        };

        // Now create the room WITH the offer already included
        await set(newRoomRef, {
            creatorId: userId,
            creatorDjangoId: djangoUserId,
            status: 'waiting',
            createdAt: timestamp,
            offer: offer  // Include offer from the start!
        });

        log('Room created with offer');

        // Add to waiting rooms
        await set(ref(db, `waiting_rooms/${currentRoomId}`), {
            creatorId: userId,
            creatorDjangoId: djangoUserId,
            status: 'waiting',
            createdAt: timestamp
        });

        log('Room added to waiting_rooms with ID:', currentRoomId, 'timestamp:', timestamp);

        log('Setting up caller listeners');
        await startCallAsCaller();
    } catch (error) {
        console.error("Error in findOrCreateRoom:", error);
        console.error("Error details:", error.message, error.stack);

        if (error.message === 'Timeout waiting for offer') {
            statusEl.textContent = "Connection timeout. The other user may have left. Try again.";
        } else {
            statusEl.textContent = `Error: ${error.message}. Please try again.`;
        }

        loadingSpinner.classList.add('hidden');
        nextButton.disabled = false;

        // Clean up the room if it was created
        if (currentRoomId) {
            await cleanup();
        }

        throw error;
    }
}

const startCallAsCaller = async () => {
    const roomRef = ref(db, `rooms/${currentRoomId}`);

    log('Setting up ICE candidate handler');
    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            log('Sending ICE candidate to Firebase');
            await push(ref(db, `rooms/${currentRoomId}/callerCandidates`), event.candidate.toJSON());
        }
    };

    log('Offer already created and saved, waiting for answer...');

    // Listen for answer
    onValue(roomRef, async (snapshot) => {
        const data = snapshot.val();
        if (!pc.currentRemoteDescription && data?.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            await pc.setRemoteDescription(answerDescription);

            // Store peer's Django user ID
            peerDjangoUserId = data.joinerDjangoId;
            log("Peer Django user ID:", peerDjangoUserId);

            if (peerDjangoUserId) {
                // Load peer stats for tooltip display
                loadPeerStats(peerDjangoUserId);
            }

            statusEl.textContent = 'Stranger connected!';
            loadingSpinner.classList.add('hidden');
            nextButton.disabled = false;

            // Start monitoring room for peer disconnection
            monitorRoomStatus();
        }
    });

    // Listen for remote ICE candidates
    onValue(ref(db, `rooms/${currentRoomId}/calleeCandidates`), (snapshot) => {
        snapshot.forEach((childSnapshot) => {
            const candidate = new RTCIceCandidate(childSnapshot.val());
            pc.addIceCandidate(candidate);
        });
    });
};

const startCallAsCallee = async () => {
    const roomRef = ref(db, `rooms/${currentRoomId}`);

    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            log('📤 Sending ICE candidate to Firebase (callee)');
            await push(ref(db, `rooms/${currentRoomId}/calleeCandidates`), event.candidate.toJSON());
        }
    };

    log('🎯 Starting as callee for room:', currentRoomId);
    statusEl.textContent = 'Connecting to stranger...';

    try {
        // First, get the current room data to check if offer exists
        log('📡 Fetching current room data...');
        const roomSnapshot = await get(roomRef);
        const roomData = roomSnapshot.val();

        log('📋 Current room data:', JSON.stringify(roomData, null, 2));

        if (!roomData) {
            throw new Error('Room data not found');
        }

        if (!roomData.offer || !roomData.offer.type || !roomData.offer.sdp) {
            throw new Error('No valid offer found in room');
        }

        log('✅ Offer found in room! Type:', roomData.offer.type);
        const offerDescription = roomData.offer;

        log('🔄 Setting remote description (offer)...');
        await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

        log('🔄 Creating answer...');
        const answerDescription = await pc.createAnswer();

        log('🔄 Setting local description (answer)...');
        await pc.setLocalDescription(answerDescription);

        const answer = {
            type: answerDescription.type,
            sdp: answerDescription.sdp,
        };

        log('📤 Saving answer to Firebase...');
        await update(roomRef, { answer });
        log('✅ Answer saved to Firebase successfully');

        // Listen for ICE candidates from caller
        log('👂 Listening for caller ICE candidates...');
        onValue(ref(db, `rooms/${currentRoomId}/callerCandidates`), (snapshot) => {
            snapshot.forEach((childSnapshot) => {
                const candidate = new RTCIceCandidate(childSnapshot.val());
                log('📥 Received ICE candidate from caller');
                pc.addIceCandidate(candidate).catch(e => log('Error adding ICE candidate:', e));
            });
        });

        statusEl.textContent = 'Connected to stranger!';
        loadingSpinner.classList.add('hidden');
        nextButton.disabled = false;

        log('✅ Callee setup complete!');

        // Start monitoring room for peer disconnection
        monitorRoomStatus();

        return Promise.resolve();
    } catch (error) {
        console.error('❌ Error in startCallAsCallee:', error);
        statusEl.textContent = `Connection failed: ${error.message}`;
        throw error;
    }
};

const cleanup = async () => {
    // Stop room monitoring
    if (roomListener) {
        roomListener();
        roomListener = null;
        log('Room monitoring stopped');
    }

    if (currentRoomId) {
        try {
            // Remove room and waiting room entries
            await remove(ref(db, `rooms/${currentRoomId}`));
            await remove(ref(db, `waiting_rooms/${currentRoomId}`));
        } catch (error) {
            console.warn('Error cleaning up room:', error);
        }
    }

    // Stop all tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            localStream.removeTrack(track);
        });
        localStream = null;
    }

    if (remoteStream) {
        remoteStream.getTracks().forEach(track => {
            track.stop();
            remoteStream.removeTrack(track);
        });
        remoteStream = null;
    }

    // Clean up WebRTC connection
    if (pc) {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.close();
        pc = new RTCPeerConnection(servers);
    }

    // Clear video elements
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
    }
    if (localVideo.srcObject) {
        localVideo.srcObject = null;
    }

    currentRoomId = null;
    peerDjangoUserId = null;
    clearPeerStats();
    resetMediaButtonStates();
    isAudioEnabled = true;
    isVideoEnabled = true;

    // Show the header when chat ends
    const chatHeader = document.getElementById('chat-header');
    if (chatHeader) {
        chatHeader.classList.remove('hidden');
    }
};

// Handle stop chat
const stopChat = async () => {
    stopButton.disabled = true;
    statusEl.textContent = 'Ending chat...';

    await cleanup();

    // Reset UI
    videoContainer.classList.add('hidden');
    startButton.classList.remove('hidden');
    startButton.disabled = false;
    homeButton.classList.remove('hidden');
    nextButton.classList.add('hidden');
    stopButton.classList.add('hidden');
    reportButton.classList.add('hidden');
    rateButton.classList.add('hidden');
    if (connectButton) {
        connectButton.classList.add('hidden');
    }
    stopButton.disabled = false;
    statusEl.textContent = 'Chat ended. Click Start Chat to begin a new chat.';
};

// Handle finding a new chat
const findNewChat = async () => {
    nextButton.disabled = true;
    statusEl.textContent = 'Finding a new stranger...';
    await cleanup();
    try {
        await setupStreams();
        await findOrCreateRoom();
    } catch (error) {
        console.error('Error finding new chat:', error);
        console.error('Error stack:', error.stack);
        nextButton.disabled = false;
        statusEl.textContent = `Error: ${error.message || 'Error finding new chat. Please try again.'}`;
    }
};

// Function to fetch and display peer stats
async function loadPeerStats(userId) {
    if (!userId) return;

    // Clear previous stats first
    clearPeerStats();

    try {
        const response = await fetch(`/get-peer-stats/${userId}/`);
        if (!response.ok) {
            log('Error fetching peer stats:', response.status);
            return;
        }

        const data = await response.json();
        if (data.success) {
            displayPeerStats(data);
        } else {
            log('Error in peer stats response:', data.error);
        }
    } catch (error) {
        log('Error fetching peer stats:', error);
    }
}

// Function to clear peer stats from tooltip
function clearPeerStats() {
    const tooltipContent = document.getElementById('tooltipContent');
    const tooltip = document.getElementById('peerStatsTooltip');

    if (tooltipContent) {
        tooltipContent.innerHTML = '<p class="tooltip-text">Hover to load...</p>';
    }

    // Remove inline opacity style so CSS hover rule can work
    if (tooltip) {
        tooltip.style.removeProperty('opacity');
    }
}

// Function to reset audio and video button states
function resetMediaButtonStates() {
    const toggleAudio = document.getElementById('toggleAudio');
    const toggleVideo = document.getElementById('toggleVideo');

    // Reset states to enabled (true)
    isAudioEnabled = true;
    isVideoEnabled = true;

    // Remove red background class that indicates disabled state
    if (toggleAudio) {
        toggleAudio.classList.remove('bg-red-500');
        toggleAudio.setAttribute('aria-pressed', 'false');
    }

    if (toggleVideo) {
        toggleVideo.classList.remove('bg-red-500');
        toggleVideo.setAttribute('aria-pressed', 'false');
    }
}

// Function to display peer stats in tooltip
function displayPeerStats(statsData) {
    const tooltipContent = document.getElementById('tooltipContent');
    if (!tooltipContent) return;

    let html = '';

    if (statsData.is_new_user) {
        html = '<div class="new-user-badge">🆕 NEW USER</div>';
    } else {
        html = `
            <div class="stat-item">
                <span>Aura Points:</span>
                <span class="text-indigo-300 font-semibold">${statsData.aura_points}</span>
            </div>
            <div class="stat-item">
                <span>Avg Rating:</span>
                <span class="text-indigo-300 font-semibold">⭐ ${statsData.avg_rating}</span>
            </div>
            <div class="stat-item">
                <span>Ratings:</span>
                <span class="text-indigo-300 font-semibold">${statsData.total_ratings}</span>
            </div>
        `;
    }

    tooltipContent.innerHTML = html;
}

// Initialize when the page loads
window.addEventListener('load', async () => {
    try {
        log('Page loaded');

        // Initialize DOM elements
        startButton = document.getElementById('startButton');
        stopButton = document.getElementById('stopButton');
        nextButton = document.getElementById('nextButton');
        homeButton = document.getElementById('homeButton');
        connectButton = document.getElementById('connectButton');
        reportButton = document.getElementById('reportButton');
        rateButton = document.getElementById('rateButton');
        localVideo = document.getElementById('localVideo');
        remoteVideo = document.getElementById('remoteVideo');
        statusEl = document.getElementById('status');
        videoContainer = document.getElementById('video-container');
        loadingSpinner = document.getElementById('loading-spinner');
        onlineCountEl = document.getElementById('online-count');
        waitingUsersEl = document.getElementById('waiting-users');

        // Initialize report modal elements
        reportModal = document.getElementById('reportModal');
        reportForm = document.getElementById('reportForm');
        reportSuccess = document.getElementById('reportSuccess');
        closeModalBtn = document.getElementById('closeModal');
        cancelReportBtn = document.getElementById('cancelReport');
        closeSuccessModalBtn = document.getElementById('closeSuccessModal');

        // Initialize rating modal elements
        ratingModal = document.getElementById('ratingModal');
        ratingForm = document.getElementById('ratingForm');
        ratingSuccess = document.getElementById('ratingSuccess');
        closeRatingModalBtn = document.getElementById('closeRatingModal');
        cancelRatingBtn = document.getElementById('cancelRating');
        closeRatingSuccessModalBtn = document.getElementById('closeRatingSuccessModal');

        // Initialize connect modal elements
        connectModal = document.getElementById('connectModal');
        connectForm = document.getElementById('connectForm');
        connectSuccess = document.getElementById('connectSuccess');
        closeConnectModalBtn = document.getElementById('closeConnectModal');
        confirmConnectBtn = document.getElementById('confirmConnect');
        cancelConnectBtn = document.getElementById('cancelConnect');
        closeConnectSuccessModalBtn = document.getElementById('closeConnectSuccessModal');

        // Check for missing elements
        const requiredElements = {
            startButton, stopButton, nextButton, homeButton, reportButton,
            localVideo, remoteVideo, statusEl, videoContainer, loadingSpinner,
            onlineCountEl, waitingUsersEl, reportModal, reportForm, reportSuccess,
            closeModalBtn, cancelReportBtn, closeSuccessModalBtn
        };

        for (const [name, element] of Object.entries(requiredElements)) {
            if (!element) {
                console.error(`Missing element: ${name}`);
            }
        }

        log('DOM elements initialized');

        // Set up all button click handlers
        startButton.addEventListener('click', startChat);
        stopButton.addEventListener('click', stopChat);
        nextButton.addEventListener('click', findNewChat);
        homeButton.addEventListener('click', () => window.location.href = '/home/');

        document.getElementById('toggleAudio').onclick = () => {
            if (localStream) {
                const audioTrack = localStream.getAudioTracks()[0];
                if (audioTrack) {
                    isAudioEnabled = !isAudioEnabled;
                    audioTrack.enabled = isAudioEnabled;
                    const button = document.getElementById('toggleAudio');
                    button.classList.toggle('bg-red-500', !isAudioEnabled);
                    button.setAttribute('aria-pressed', !isAudioEnabled);
                }
            }
        };

        document.getElementById('toggleVideo').onclick = () => {
            if (localStream) {
                const videoTrack = localStream.getVideoTracks()[0];
                if (videoTrack) {
                    isVideoEnabled = !isVideoEnabled;
                    videoTrack.enabled = isVideoEnabled;
                    const button = document.getElementById('toggleVideo');
                    button.classList.toggle('bg-red-500', !isVideoEnabled);
                    button.setAttribute('aria-pressed', !isVideoEnabled);
                }
            }
        };

        // Report modal handlers
        reportButton.onclick = () => {
            reportModal.classList.remove('hidden');
            reportModal.classList.add('flex');
        };

        closeModalBtn.onclick = () => {
            reportModal.classList.add('hidden');
            reportModal.classList.remove('flex');
            reportForm.reset();
        };

        cancelReportBtn.onclick = () => {
            reportModal.classList.add('hidden');
            reportModal.classList.remove('flex');
            reportForm.reset();
        };

        closeSuccessModalBtn.onclick = () => {
            reportModal.classList.add('hidden');
            reportModal.classList.remove('flex');
            reportForm.classList.remove('hidden');
            reportSuccess.classList.add('hidden');
            reportForm.reset();
        };

        // Report form submission
        reportForm.onsubmit = async (e) => {
            e.preventDefault();

            const reason = document.getElementById('reportReason').value;
            const description = document.getElementById('reportDescription').value;

            if (!reason || !description.trim()) {
                alert('Please fill in all fields');
                return;
            }

            if (!peerDjangoUserId) {
                alert('Unable to identify the user to report. Please try again.');
                return;
            }

            try {
                const response = await fetch('/report-user/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        room_id: currentRoomId,
                        reported_user_id: peerDjangoUserId,
                        reason: reason,
                        description: description
                    })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    // Show success message
                    reportForm.classList.add('hidden');
                    reportSuccess.classList.remove('hidden');
                } else {
                    alert(data.error || 'Failed to submit report. Please try again.');
                }
            } catch (error) {
                console.error('Error submitting report:', error);
                alert('Failed to submit report. Please try again.');
            }
        };

        // Rating modal handlers
        rateButton.onclick = () => {
            // Reset rating form
            selectedRatingValue = 0;
            document.getElementById('selectedRating').textContent = '-';
            document.getElementById('ratingValue').value = '';
            // Reset star colors using custom CSS classes
            document.querySelectorAll('.rating-star svg').forEach(star => {
                star.classList.add('inactive');
                star.classList.remove('active');
            });
            ratingForm.classList.remove('hidden');
            ratingSuccess.classList.add('hidden');
            ratingModal.classList.remove('hidden');
            ratingModal.classList.add('flex');
        };

        closeRatingModalBtn.onclick = () => {
            ratingModal.classList.add('hidden');
            ratingModal.classList.remove('flex');
            ratingForm.reset();
        };

        cancelRatingBtn.onclick = () => {
            ratingModal.classList.add('hidden');
            ratingModal.classList.remove('flex');
            ratingForm.reset();
        };

        closeRatingSuccessModalBtn.onclick = () => {
            ratingModal.classList.add('hidden');
            ratingModal.classList.remove('flex');
            ratingForm.classList.remove('hidden');
            ratingSuccess.classList.add('hidden');
            ratingForm.reset();
        };

        // Star rating selection
        document.querySelectorAll('.rating-star').forEach(button => {
            button.onclick = (e) => {
                e.preventDefault();
                selectedRatingValue = parseInt(button.getAttribute('data-rating'));
                document.getElementById('ratingValue').value = selectedRatingValue;
                document.getElementById('selectedRating').textContent = selectedRatingValue;

                // Update star colors using custom CSS classes
                document.querySelectorAll('.rating-star svg').forEach((star, index) => {
                    if (index < selectedRatingValue) {
                        star.classList.remove('inactive');
                        star.classList.add('active');
                    } else {
                        star.classList.add('inactive');
                        star.classList.remove('active');
                    }
                });
            };
        });

        // Rating form submission
        ratingForm.onsubmit = async (e) => {
            e.preventDefault();

            const ratingValue = document.getElementById('ratingValue').value;

            if (!ratingValue) {
                alert('Please select a rating');
                return;
            }

            if (!peerDjangoUserId) {
                alert('Unable to identify the user to rate. Please try again.');
                return;
            }

            try {
                const response = await fetch('/submit-rating/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        rated_user_id: peerDjangoUserId,
                        rate_points: parseInt(ratingValue)
                    })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    // Show success message
                    ratingForm.classList.add('hidden');
                    ratingSuccess.classList.remove('hidden');
                } else {
                    alert(data.error || 'Failed to submit rating. Please try again.');
                }
            } catch (error) {
                console.error('Error submitting rating:', error);
                alert('Failed to submit rating. Please try again.');
            }
        };

        // Connect modal handlers - only if button exists (verified users only)
        if (connectButton) {
            connectButton.onclick = () => {
                connectForm.classList.remove('hidden');
                connectSuccess.classList.add('hidden');
                connectModal.classList.remove('hidden');
                connectModal.classList.add('flex');
            };
        }

        if (closeConnectModalBtn) {
            closeConnectModalBtn.onclick = () => {
                connectModal.classList.add('hidden');
                connectModal.classList.remove('flex');
            };
        }

        if (cancelConnectBtn) {
            cancelConnectBtn.onclick = () => {
                connectModal.classList.add('hidden');
                connectModal.classList.remove('flex');
            };
        }

        if (closeConnectSuccessModalBtn) {
            closeConnectSuccessModalBtn.onclick = () => {
                connectModal.classList.add('hidden');
                connectModal.classList.remove('flex');
                connectForm.classList.remove('hidden');
                connectSuccess.classList.add('hidden');
            };
        }

        // Connect confirmation - only if button exists (verified users only)
        if (confirmConnectBtn) {
            confirmConnectBtn.onclick = async () => {
            if (!peerDjangoUserId) {
                alert('Unable to identify the user to connect with. Please try again.');
                return;
            }

            try {
                confirmConnectBtn.disabled = true;
                confirmConnectBtn.textContent = 'Connecting...';

                const response = await fetch('/submit-connection/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        connection_user_id: peerDjangoUserId
                    })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    // Show success message
                    connectForm.classList.add('hidden');
                    connectSuccess.classList.remove('hidden');
                } else {
                    alert(data.error || 'Failed to connect. Please try again.');
                }
            } catch (error) {
                console.error('Error submitting connection:', error);
                alert('Failed to connect. Please try again.');
            } finally {
                confirmConnectBtn.disabled = false;
                confirmConnectBtn.textContent = 'Connect';
            }
            };
        }

        log('All button click handlers attached');

        await checkMediaPermissions();
        log('Starting initialization');
        await initialize();
        log('Initialization complete');
    } catch (error) {
        console.error('Initialization error:', error);
        if (statusEl) {
            statusEl.textContent = 'Failed to initialize. Please refresh the page.';
        }
    }
});

// Clean up presence when page is closed
window.addEventListener('beforeunload', async () => {
    await removePresence();
});
