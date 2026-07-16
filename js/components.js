// Toast Notification manager and modal UI controllers

// --- TOAST ALERTS SYSTEM ---
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} slide-in`;
    
    let icon = '🔔';
    if (type === 'success') icon = '✅';
    else if (type === 'error' || type === 'danger') icon = '🛑';
    else if (type === 'warning') icon = '⚠️';
    else if (type === 'info') icon = 'ℹ️';

    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
        <span class="toast-close">&times;</span>
    `;

    container.appendChild(toast);

    // Auto-remove toast after 4.5 seconds
    const timer = setTimeout(() => {
        removeToast(toast);
    }, 4500);

    toast.querySelector('.toast-close').addEventListener('click', () => {
        clearTimeout(timer);
        removeToast(toast);
    });
}

function removeToast(toast) {
    toast.classList.remove('slide-in');
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
        toast.remove();
    });
}

// --- MODAL UTILS ---
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Lock background scrolling
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = ''; // Restore scroll
    }
}

function setupModalDismissers() {
    // Dismiss modal if clicking overlay background
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(overlay.id);
            }
        });
    });

    // Close on escape keypress
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const activeModal = document.querySelector('.modal-overlay.active');
            if (activeModal) {
                closeModal(activeModal.id);
            }
        }
    });
}

// Attach to window global object
window.UI = {
    showToast,
    openModal,
    closeModal,
    setupModalDismissers
};
