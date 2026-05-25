package auth

import (
	"os"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestMain(m *testing.M) {
	restoreHashCost := SetHashCostForTesting(bcrypt.MinCost)
	code := m.Run()
	restoreHashCost()
	os.Exit(code)
}
