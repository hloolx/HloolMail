package observability

import (
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var httpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
	Name:    "http_request_duration_seconds",
	Help:    "HTTP request latency in seconds.",
	Buckets: prometheus.DefBuckets,
}, []string{"method", "route", "status"})

var smtpMessagesReceived = promauto.NewCounter(prometheus.CounterOpts{
	Name: "smtp_messages_received_total",
	Help: "SMTP messages stored successfully.",
})

var smtpMessagesRejected = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "smtp_messages_rejected_total",
	Help: "SMTP messages or recipients rejected before storage.",
}, []string{"reason"})

var webhookDeliveries = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "webhook_deliveries_total",
	Help: "Webhook delivery outcomes.",
}, []string{"outcome"})

var webhookQueueDepth = promauto.NewGauge(prometheus.GaugeOpts{
	Name: "webhook_queue_depth",
	Help: "Webhook deliveries waiting for a due attempt.",
})

func ObserveHTTPRequest(method, route string, status int, duration time.Duration) {
	if route == "" {
		route = "unknown"
	}
	httpRequestDuration.WithLabelValues(method, route, strconv.Itoa(status)).Observe(duration.Seconds())
}

func ObserveSMTPMessageReceived() {
	smtpMessagesReceived.Inc()
}

func ObserveSMTPMessageRejected(reason string) {
	if reason == "" {
		reason = "unknown"
	}
	smtpMessagesRejected.WithLabelValues(reason).Inc()
}

func ObserveWebhookDelivery(outcome string) {
	if outcome == "" {
		outcome = "unknown"
	}
	webhookDeliveries.WithLabelValues(outcome).Inc()
}

func SetWebhookQueueDepth(depth int64) {
	if depth < 0 {
		depth = 0
	}
	webhookQueueDepth.Set(float64(depth))
}
