package events

import (
	"strings"
	"sync"
)

type MessageEvent struct {
	ID        string `json:"id"`
	Recipient string `json:"recipient"`
	Subject   string `json:"subject"`
	From      string `json:"from"`
	CreatedAt string `json:"created_at"`
}

type NotificationEvent struct {
	ID        uint   `json:"id"`
	Type      string `json:"type"`
	Message   string `json:"message"`
	DomainID  *uint  `json:"domain_id,omitempty"`
	Read      bool   `json:"read"`
	CreatedAt string `json:"created_at"`
}

const maxSubscribersPerEmail = 64
const maxGlobalSubscribers = 10000

type Hub struct {
	mu                  sync.RWMutex
	clients             map[string]map[chan MessageEvent]struct{}
	notificationClients map[string]map[chan NotificationEvent]struct{}
}

func NewHub() *Hub {
	return &Hub{
		clients:             make(map[string]map[chan MessageEvent]struct{}),
		notificationClients: make(map[string]map[chan NotificationEvent]struct{}),
	}
}

func (h *Hub) Subscribe(email string) (<-chan MessageEvent, func()) {
	email = normalize(email)
	h.mu.Lock()
	if h.clients[email] == nil {
		h.clients[email] = make(map[chan MessageEvent]struct{})
	}
	if len(h.clients[email]) >= maxSubscribersPerEmail {
		h.mu.Unlock()
		ch := make(chan MessageEvent)
		close(ch)
		return ch, func() {}
	}
	total := 0
	for _, subs := range h.clients {
		total += len(subs)
	}
	if total >= maxGlobalSubscribers {
		h.mu.Unlock()
		ch := make(chan MessageEvent)
		close(ch)
		return ch, func() {}
	}
	ch := make(chan MessageEvent, 256)
	h.clients[email][ch] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		if clients := h.clients[email]; clients != nil {
			delete(clients, ch)
			if len(clients) == 0 {
				delete(h.clients, email)
			}
		}
		h.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}

func (h *Hub) Publish(email string, event MessageEvent) {
	email = normalize(email)
	h.mu.RLock()
	clients := h.clients[email]
	for ch := range clients {
		select {
		case ch <- event:
		default:
		}
	}
	h.mu.RUnlock()
}

func (h *Hub) SubscribeNotifications(keys []string) (<-chan NotificationEvent, func()) {
	ch := make(chan NotificationEvent, 256)
	normalized := make([]string, 0, len(keys))
	seen := map[string]bool{}
	for _, key := range keys {
		key = strings.TrimSpace(strings.ToLower(key))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		normalized = append(normalized, key)
	}
	h.mu.Lock()
	for _, key := range normalized {
		if h.notificationClients[key] == nil {
			h.notificationClients[key] = make(map[chan NotificationEvent]struct{})
		}
		h.notificationClients[key][ch] = struct{}{}
	}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		for _, key := range normalized {
			if clients := h.notificationClients[key]; clients != nil {
				delete(clients, ch)
				if len(clients) == 0 {
					delete(h.notificationClients, key)
				}
			}
		}
		h.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}

func (h *Hub) PublishNotification(keys []string, event NotificationEvent) {
	h.mu.RLock()
	sent := map[chan NotificationEvent]bool{}
	for _, key := range keys {
		key = strings.TrimSpace(strings.ToLower(key))
		for ch := range h.notificationClients[key] {
			if sent[ch] {
				continue
			}
			sent[ch] = true
			select {
			case ch <- event:
			default:
			}
		}
	}
	h.mu.RUnlock()
}

func normalize(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
