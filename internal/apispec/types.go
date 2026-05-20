package apispec

import "strings"

type AuthKind string

const (
	AuthPublic  AuthKind = "public"
	AuthAPIKey  AuthKind = "apiKey"
	AuthSession AuthKind = "session"
)

type Config struct {
	BaseURL    string
	ExpectedMX string
	Version    string
}

type Parameter struct {
	Name        string
	In          string
	Required    bool
	Description string
	Schema      Schema
	Example     any
}

type RequestBody struct {
	Description string
	SchemaName  string
	Example     string
	Required    bool
}

type OperationResponse struct {
	Status      int
	Description string
	SchemaName  string
}

type FrontendHints struct {
	Title         string
	Description   string
	RequestPath   string
	QueryTemplate string
	BodyTemplate  string
	Dangerous     bool
}

type Operation struct {
	ID          string
	Method      string
	Path        string
	Tags        []string
	Summary     string
	Description string
	Auth        AuthKind
	Parameters  []Parameter
	RequestBody *RequestBody
	Responses   []OperationResponse
	Frontend    *FrontendHints
}

func (op Operation) DisplayPath() string {
	path := op.Path
	for {
		start := strings.Index(path, "{")
		if start < 0 {
			return path
		}
		end := strings.Index(path[start:], "}")
		if end < 0 {
			return path
		}
		name := path[start+1 : start+end]
		path = path[:start] + ":" + name + path[start+end+1:]
	}
}

func (op Operation) PrimaryResponse() OperationResponse {
	if len(op.Responses) == 0 {
		return OperationResponse{Status: 200, Description: "Success", SchemaName: "SuccessEnvelope"}
	}
	return op.Responses[0]
}

func (op Operation) IsAutomation() bool {
	return op.Auth == AuthAPIKey && hasTag(op.Tags, TagAutomation)
}

func (op Operation) IsPublicMeta() bool {
	return op.Auth == AuthPublic && hasTag(op.Tags, TagPublicMeta)
}

func (op Operation) IsWebSession() bool {
	return op.Auth == AuthSession && hasTag(op.Tags, TagWebSession)
}

func hasTag(tags []string, tag string) bool {
	for _, value := range tags {
		if value == tag {
			return true
		}
	}
	return false
}

const (
	TagAutomation = "API Key automation"
	TagPublicMeta = "Public metadata"
	TagWebSession = "Web session API"
)

type FrontendOperation struct {
	Method        string   `json:"method" yaml:"method"`
	Path          string   `json:"path" yaml:"path"`
	Auth          AuthKind `json:"auth" yaml:"auth"`
	RequestPath   string   `json:"requestPath" yaml:"requestPath"`
	QueryTemplate string   `json:"queryTemplate,omitempty" yaml:"queryTemplate,omitempty"`
	BodyTemplate  string   `json:"bodyTemplate,omitempty" yaml:"bodyTemplate,omitempty"`
	Dangerous     bool     `json:"dangerous,omitempty" yaml:"dangerous,omitempty"`
	Title         string   `json:"title" yaml:"title"`
	Description   string   `json:"description" yaml:"description"`
}
