package httpapi

import (
	"os"
	"testing"

	"gptmail/internal/auth"

	"golang.org/x/crypto/bcrypt"
)

func TestMain(m *testing.M) {
	restoreHashCost := auth.SetHashCostForTesting(bcrypt.MinCost)
	code := m.Run()
	restoreHashCost()
	os.Exit(code)
}
