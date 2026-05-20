package apispec

type Schema map[string]any

func schemaRef(name string) Schema {
	return Schema{"$ref": "#/components/schemas/" + name}
}

func objectSchema(required []string, properties map[string]any) Schema {
	schema := Schema{
		"type":                 "object",
		"additionalProperties": false,
		"properties":           properties,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func arraySchema(items any) Schema {
	return Schema{"type": "array", "items": items}
}

func stringSchema(format string) Schema {
	schema := Schema{"type": "string"}
	if format != "" {
		schema["format"] = format
	}
	return schema
}

func integerSchema(format string) Schema {
	schema := Schema{"type": "integer"}
	if format != "" {
		schema["format"] = format
	}
	return schema
}

func boolSchema() Schema {
	return Schema{"type": "boolean"}
}

func nullable(schema Schema) Schema {
	out := Schema{}
	for key, value := range schema {
		out[key] = value
	}
	out["nullable"] = true
	return out
}

func envelopeSchema(data any) Schema {
	return objectSchema([]string{"success", "data", "error"}, map[string]any{
		"success": boolSchema(),
		"data":    data,
		"error":   nullable(stringSchema("")),
		"usage":   schemaRef("Usage"),
	})
}

func Schemas() map[string]Schema {
	return map[string]Schema{
		"Usage": objectSchema(nil, map[string]any{
			"used_today":      stringSchema(""),
			"daily_limit":     stringSchema(""),
			"remaining_today": stringSchema(""),
			"daily_unlimited": stringSchema(""),
			"total_usage":     stringSchema(""),
			"total_limit":     stringSchema(""),
			"remaining_total": stringSchema(""),
			"total_unlimited": stringSchema(""),
		}),
		"ErrorEnvelope":   envelopeSchema(Schema{"nullable": true}),
		"SuccessEnvelope": envelopeSchema(Schema{"type": "object", "additionalProperties": true}),
		"HealthData": objectSchema([]string{"status", "time"}, map[string]any{
			"status": stringSchema(""),
			"time":   stringSchema("date-time"),
		}),
		"VersionData": objectSchema([]string{"version", "commit", "buildTime"}, map[string]any{
			"version":   stringSchema(""),
			"commit":    stringSchema(""),
			"buildTime": stringSchema(""),
		}),
		"AvailableDomain": objectSchema([]string{"id", "domain", "mode", "message_count"}, map[string]any{
			"id":            integerSchema("uint64"),
			"domain":        stringSchema(""),
			"mode":          stringSchema(""),
			"message_count": integerSchema("int64"),
		}),
		"Domain": objectSchema([]string{"id", "domain", "mode", "active", "mx_verified"}, map[string]any{
			"id":                    integerSchema("uint64"),
			"domain":                stringSchema(""),
			"mode":                  stringSchema(""),
			"owner_id":              integerSchema("uint64"),
			"active":                boolSchema(),
			"mx_verified":           boolSchema(),
			"wildcard_enabled":      boolSchema(),
			"wildcard_requested":    boolSchema(),
			"domain_expires_at":     stringSchema("date-time"),
			"message_count":         integerSchema("int64"),
			"mailbox_created_count": integerSchema("int64"),
			"created_at":            stringSchema("date-time"),
			"updated_at":            stringSchema("date-time"),
		}),
		"AvailableDomainsData": objectSchema([]string{"domains", "public_domains", "private_domains"}, map[string]any{
			"domains":                   arraySchema(stringSchema("")),
			"public_domains":            arraySchema(schemaRef("AvailableDomain")),
			"private_domains":           arraySchema(schemaRef("AvailableDomain")),
			"public_unavailable_reason": stringSchema(""),
		}),
		"GenerateEmailRequest": objectSchema(nil, map[string]any{
			"prefix": stringSchema(""),
			"domain": stringSchema(""),
			"share":  Schema{"oneOf": []any{boolSchema(), schemaRef("GenerateEmailShareOptions")}},
		}),
		"GenerateEmailShareOptions": objectSchema(nil, map[string]any{
			"enabled":    boolSchema(),
			"expires_at": stringSchema("date-time"),
		}),
		"GenerateEmailData": objectSchema([]string{"email", "domain_id", "domain"}, map[string]any{
			"email":     stringSchema("email"),
			"domain_id": integerSchema("uint64"),
			"domain":    schemaRef("Domain"),
			"reuse":     boolSchema(),
			"share":     schemaRef("GeneratedMailboxShare"),
		}),
		"GeneratedMailboxShare": objectSchema([]string{"id", "resource_type", "token_prefix", "url", "access_url"}, map[string]any{
			"id":            integerSchema("uint64"),
			"resource_type": stringSchema(""),
			"token":         stringSchema(""),
			"key":           stringSchema(""),
			"token_prefix":  stringSchema(""),
			"url":           stringSchema("uri"),
			"access_url":    stringSchema("uri"),
			"expires_at":    stringSchema("date-time"),
		}),
		"Mailbox": objectSchema([]string{"id", "owner_id", "email", "local_part", "host", "domain_id", "created_at", "updated_at"}, map[string]any{
			"id":              integerSchema("uint64"),
			"owner_id":        integerSchema("uint64"),
			"email":           stringSchema("email"),
			"local_part":      stringSchema(""),
			"host":            stringSchema(""),
			"domain_id":       integerSchema("uint64"),
			"message_count":   integerSchema("int64"),
			"last_message_at": stringSchema("date-time"),
			"created_at":      stringSchema("date-time"),
			"updated_at":      stringSchema("date-time"),
		}),
		"MailboxPage": pageSchema(schemaRef("Mailbox")),
		"DeleteMailboxData": objectSchema([]string{"deleted", "messages_deleted"}, map[string]any{
			"deleted":          boolSchema(),
			"messages_deleted": integerSchema("int64"),
		}),
		"AttachmentMetadata": objectSchema([]string{"id", "sequence", "size_bytes"}, map[string]any{
			"id":                stringSchema(""),
			"sequence":          integerSchema("int32"),
			"filename":          stringSchema(""),
			"content_type":      stringSchema(""),
			"disposition":       stringSchema(""),
			"content_id":        stringSchema(""),
			"transfer_encoding": stringSchema(""),
			"size_bytes":        integerSchema("int64"),
			"sha256":            stringSchema(""),
			"inline":            boolSchema(),
			"created_at":        stringSchema("date-time"),
		}),
		"MessageSummary": objectSchema([]string{"id", "recipient", "from_address", "subject", "seen", "preview", "attachment_count", "created_at", "expires_at"}, map[string]any{
			"id":               stringSchema(""),
			"recipient":        stringSchema("email"),
			"from_address":     stringSchema("email"),
			"from_name":        stringSchema(""),
			"subject":          stringSchema(""),
			"seen":             boolSchema(),
			"preview":          stringSchema(""),
			"attachment_count": integerSchema("int64"),
			"created_at":       stringSchema("date-time"),
			"expires_at":       stringSchema("date-time"),
		}),
		"MessageDetail": objectSchema([]string{"id", "recipient", "from_address", "subject", "seen", "attachment_count", "attachments", "created_at", "expires_at"}, map[string]any{
			"id":               stringSchema(""),
			"recipient":        stringSchema("email"),
			"from_address":     stringSchema("email"),
			"from_name":        stringSchema(""),
			"subject":          stringSchema(""),
			"seen":             boolSchema(),
			"text_content":     stringSchema(""),
			"html_content":     stringSchema(""),
			"headers_json":     stringSchema(""),
			"attachment_count": integerSchema("int64"),
			"attachments":      arraySchema(schemaRef("AttachmentMetadata")),
			"created_at":       stringSchema("date-time"),
			"expires_at":       stringSchema("date-time"),
		}),
		"MessagePage": pageSchema(schemaRef("MessageSummary")),
		"NextEmailData": objectSchema([]string{"has_email", "message"}, map[string]any{
			"has_email": boolSchema(),
			"message":   nullable(schemaRef("MessageDetail")),
		}),
		"MarkReadData": objectSchema([]string{"id", "seen"}, map[string]any{
			"id":   stringSchema(""),
			"seen": boolSchema(),
		}),
		"DeleteMessageData": objectSchema([]string{"deleted"}, map[string]any{
			"deleted": boolSchema(),
		}),
		"ClearEmailsData": objectSchema([]string{"cleared"}, map[string]any{
			"cleared": boolSchema(),
		}),
		"StatsData": objectSchema([]string{"messages", "domains", "api_keys", "mailboxes", "public_domains", "api_calls_today"}, map[string]any{
			"messages":        integerSchema("int64"),
			"domains":         integerSchema("int64"),
			"api_keys":        integerSchema("int64"),
			"mailboxes":       integerSchema("int64"),
			"public_domains":  integerSchema("int64"),
			"api_calls_today": integerSchema("int64"),
		}),
		"ShareLink": objectSchema([]string{"id", "resource_type", "mailbox_id", "token_prefix", "key_set", "access_count", "created_at", "updated_at"}, map[string]any{
			"id":               integerSchema("uint64"),
			"resource_type":    stringSchema(""),
			"mailbox_id":       integerSchema("uint64"),
			"token":            stringSchema(""),
			"access_key":       stringSchema(""),
			"token_prefix":     stringSchema(""),
			"share_url":        stringSchema("uri"),
			"access_url":       stringSchema("uri"),
			"key_set":          boolSchema(),
			"expires_at":       stringSchema("date-time"),
			"revoked_at":       stringSchema("date-time"),
			"access_count":     integerSchema("int64"),
			"last_accessed_at": stringSchema("date-time"),
			"created_at":       stringSchema("date-time"),
			"updated_at":       stringSchema("date-time"),
		}),
		"ShareLinkPage": pageSchema(schemaRef("ShareLink")),
		"CreateShareLinkRequest": objectSchema([]string{"mailbox_id"}, map[string]any{
			"resource_type": stringSchema(""),
			"mailbox_id":    integerSchema("uint64"),
			"expires_at":    stringSchema("date-time"),
		}),
		"PatchShareLinkRequest": objectSchema(nil, map[string]any{
			"expires_at": stringSchema("date-time"),
		}),
		"PublicSharedMailboxMetadata": objectSchema([]string{"id", "email", "message_count", "created_at"}, map[string]any{
			"id":              integerSchema("uint64"),
			"email":           stringSchema("email"),
			"local_part":      stringSchema(""),
			"host":            stringSchema(""),
			"domain_id":       integerSchema("uint64"),
			"message_count":   integerSchema("int64"),
			"last_message_at": stringSchema("date-time"),
			"created_at":      stringSchema("date-time"),
		}),
		"PublicSharedLocked": objectSchema([]string{"resource_type", "token_prefix", "key_required"}, map[string]any{
			"resource_type": stringSchema(""),
			"token_prefix":  stringSchema(""),
			"key_required":  boolSchema(),
			"locked":        boolSchema(),
			"expires_at":    stringSchema("date-time"),
			"mailbox":       schemaRef("PublicSharedMailboxMetadata"),
		}),
		"PublicSharedMailboxMessage": objectSchema([]string{"id", "recipient", "from_address", "subject", "attachments", "created_at", "expires_at"}, map[string]any{
			"resource_type": stringSchema(""),
			"id":            stringSchema(""),
			"recipient":     stringSchema("email"),
			"from_address":  stringSchema("email"),
			"from_name":     stringSchema(""),
			"subject":       stringSchema(""),
			"text_content":  stringSchema(""),
			"html_content":  stringSchema(""),
			"attachments":   arraySchema(schemaRef("AttachmentMetadata")),
			"created_at":    stringSchema("date-time"),
			"expires_at":    stringSchema("date-time"),
		}),
		"PublicSharedMailbox": objectSchema([]string{"resource_type", "token_prefix", "mailbox"}, map[string]any{
			"resource_type": stringSchema(""),
			"token_prefix":  stringSchema(""),
			"expires_at":    stringSchema("date-time"),
			"mailbox":       schemaRef("PublicSharedMailboxMetadata"),
		}),
		"ShareLinkAccessLog": objectSchema([]string{"id", "share_link_id", "resource_type", "success", "ip", "user_agent", "created_at"}, map[string]any{
			"id":             integerSchema("uint64"),
			"share_link_id":  integerSchema("uint64"),
			"resource_type":  stringSchema(""),
			"mailbox_id":     integerSchema("uint64"),
			"success":        boolSchema(),
			"failure_reason": stringSchema(""),
			"ip":             stringSchema(""),
			"user_agent":     stringSchema(""),
			"created_at":     stringSchema("date-time"),
		}),
		"ShareLinkAccessLogPage": pageSchema(schemaRef("ShareLinkAccessLog")),
		"WebhookEndpoint": objectSchema([]string{"id", "name", "url", "enabled", "events", "scope", "failure_count", "created_at", "updated_at"}, map[string]any{
			"id":              integerSchema("uint64"),
			"name":            stringSchema(""),
			"url":             stringSchema("uri"),
			"secret":          stringSchema(""),
			"secret_preview":  stringSchema(""),
			"enabled":         boolSchema(),
			"events":          arraySchema(stringSchema("")),
			"scope":           stringSchema(""),
			"domain_id":       integerSchema("uint64"),
			"mailbox_id":      integerSchema("uint64"),
			"last_success_at": stringSchema("date-time"),
			"last_failure_at": stringSchema("date-time"),
			"failure_count":   integerSchema("int32"),
			"disabled_at":     stringSchema("date-time"),
			"created_at":      stringSchema("date-time"),
			"updated_at":      stringSchema("date-time"),
		}),
		"WebhookEndpointPage": pageSchema(schemaRef("WebhookEndpoint")),
		"WebhookRequest": objectSchema([]string{"name", "url"}, map[string]any{
			"name":       stringSchema(""),
			"url":        stringSchema("uri"),
			"events":     arraySchema(stringSchema("")),
			"scope":      stringSchema(""),
			"domain_id":  integerSchema("uint64"),
			"mailbox_id": integerSchema("uint64"),
			"enabled":    boolSchema(),
		}),
		"PatchWebhookRequest": objectSchema(nil, map[string]any{
			"name":       stringSchema(""),
			"url":        stringSchema("uri"),
			"events":     arraySchema(stringSchema("")),
			"scope":      stringSchema(""),
			"domain_id":  integerSchema("uint64"),
			"mailbox_id": integerSchema("uint64"),
			"enabled":    boolSchema(),
		}),
		"WebhookDelivery": objectSchema([]string{"id", "endpoint_id", "event_type", "status", "attempt_count", "max_attempts", "created_at", "updated_at"}, map[string]any{
			"id":              stringSchema(""),
			"endpoint_id":     integerSchema("uint64"),
			"event_type":      stringSchema(""),
			"message_id":      stringSchema(""),
			"status":          stringSchema(""),
			"attempt_count":   integerSchema("int32"),
			"max_attempts":    integerSchema("int32"),
			"next_attempt_at": stringSchema("date-time"),
			"last_attempt_at": stringSchema("date-time"),
			"succeeded_at":    stringSchema("date-time"),
			"response_status": integerSchema("int32"),
			"response_body":   stringSchema(""),
			"error":           stringSchema(""),
			"created_at":      stringSchema("date-time"),
			"updated_at":      stringSchema("date-time"),
		}),
		"WebhookDeliveryPage": pageSchema(schemaRef("WebhookDelivery")),
		"DeletedData": objectSchema([]string{"deleted"}, map[string]any{
			"deleted": boolSchema(),
		}),
	}
}

func EnvelopeSchemas() map[string]Schema {
	dataSchemas := map[string]string{
		"EnvelopeHealth":              "HealthData",
		"EnvelopeVersion":             "VersionData",
		"EnvelopeAvailableDomains":    "AvailableDomainsData",
		"EnvelopeGenerateEmail":       "GenerateEmailData",
		"EnvelopeMailboxPage":         "MailboxPage",
		"EnvelopeMailboxDelete":       "DeleteMailboxData",
		"EnvelopeMessagePage":         "MessagePage",
		"EnvelopeNextEmail":           "NextEmailData",
		"EnvelopeMessageDetail":       "MessageDetail",
		"EnvelopeMarkRead":            "MarkReadData",
		"EnvelopeDeleteMessage":       "DeleteMessageData",
		"EnvelopeClearEmails":         "ClearEmailsData",
		"EnvelopeStats":               "StatsData",
		"EnvelopeShareLink":           "ShareLink",
		"EnvelopeShareLinkPage":       "ShareLinkPage",
		"EnvelopeShareLinkAccessLogs": "ShareLinkAccessLogPage",
		"EnvelopeWebhook":             "WebhookEndpoint",
		"EnvelopeWebhookPage":         "WebhookEndpointPage",
		"EnvelopeWebhookDelivery":     "WebhookDelivery",
		"EnvelopeWebhookDeliveries":   "WebhookDeliveryPage",
		"EnvelopeDeleted":             "DeletedData",
	}
	out := map[string]Schema{}
	for envelopeName, dataName := range dataSchemas {
		out[envelopeName] = envelopeSchema(schemaRef(dataName))
	}
	out["EnvelopePublicShared"] = envelopeSchema(Schema{"oneOf": []any{
		schemaRef("PublicSharedLocked"),
		schemaRef("PublicSharedMailbox"),
	}})
	out["EnvelopePublicSharedMailboxMessages"] = envelopeSchema(schemaRef("MessagePage"))
	out["EnvelopePublicSharedMailboxMessage"] = envelopeSchema(schemaRef("PublicSharedMailboxMessage"))
	return out
}

func AllSchemas() map[string]Schema {
	out := Schemas()
	for name, schema := range EnvelopeSchemas() {
		out[name] = schema
	}
	return out
}

func pageSchema(item any) Schema {
	return objectSchema([]string{"items", "page", "per_page", "total", "total_pages"}, map[string]any{
		"items":       arraySchema(item),
		"page":        integerSchema("int32"),
		"per_page":    integerSchema("int32"),
		"total":       integerSchema("int64"),
		"total_pages": integerSchema("int32"),
	})
}
