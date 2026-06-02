package httpapi

import "strings"

const likeEscapeClause = " ESCAPE '\\'"

var likeEscaper = strings.NewReplacer(
	"\\", "\\\\",
	"%", "\\%",
	"_", "\\_",
)

func likeContainsLiteral(value string) string {
	return "%" + likeEscaper.Replace(value) + "%"
}
