package main

import (
	"context"
	"log/slog"
	"os"

	"gptmail/internal/cli"
	"gptmail/internal/serverapp"
)

func main() {
	args := os.Args[1:]
	if len(args) == 0 || args[0] == "serve" {
		if err := serverapp.RunWithSignals(); err != nil {
			slog.Error("server stopped", "error", err)
			os.Exit(1)
		}
		return
	}
	os.Exit(cli.Execute(context.Background(), args, cli.OSRunner()))
}
