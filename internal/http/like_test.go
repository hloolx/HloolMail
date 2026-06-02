package httpapi

import "testing"

func TestLikeContainsLiteralEscapesWildcards(t *testing.T) {
	got := likeContainsLiteral(`a%b_c\path`)
	want := `%a\%b\_c\\path%`
	if got != want {
		t.Fatalf("like pattern = %q, want %q", got, want)
	}
}
