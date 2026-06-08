package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestFailRedactsServerErrorMessage(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.GET("/boom", func(c *gin.Context) {
		fail(c, http.StatusInternalServerError, "sql connect failed: password=secret")
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/boom", nil))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	var payload struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Success {
		t.Fatal("expected failure payload")
	}
	if payload.Error != http.StatusText(http.StatusInternalServerError) {
		t.Fatalf("error = %q, want %q", payload.Error, http.StatusText(http.StatusInternalServerError))
	}
	if strings.Contains(recorder.Body.String(), "password=secret") {
		t.Fatalf("server error leaked internal detail: %s", recorder.Body.String())
	}
}

func TestFailKeepsClientErrorMessage(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.GET("/bad-request", func(c *gin.Context) {
		fail(c, http.StatusBadRequest, "email is required")
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/bad-request", nil))

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error != "email is required" {
		t.Fatalf("error = %q, want client validation message", payload.Error)
	}
}
