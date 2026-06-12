package main

import (
	"flag"
	"fmt"
	"os"

	"gptmail/internal/apispec"
	"gptmail/internal/version"
)

func main() {
	baseURL := flag.String("base-url", "http://localhost:3000", "public base URL for the OpenAPI server entry")
	expectedMX := flag.String("expected-mx", "mail.example.com", "expected MX hostname used in generated docs")
	specVersion := flag.String("version", version.Version, "OpenAPI document version")
	flag.Parse()

	data, err := apispec.JSON(apispec.Config{
		BaseURL:    *baseURL,
		ExpectedMX: *expectedMX,
		Version:    *specVersion,
	})
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	_, _ = os.Stdout.Write(data)
	_, _ = os.Stdout.Write([]byte("\n"))
}
