package db

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type slogGormLogger struct {
	level         logger.LogLevel
	slowThreshold time.Duration
}

func newGormLogger() logger.Interface {
	return slogGormLogger{
		level:         logger.Warn,
		slowThreshold: 200 * time.Millisecond,
	}
}

func (l slogGormLogger) LogMode(level logger.LogLevel) logger.Interface {
	l.level = level
	return l
}

func (l slogGormLogger) Info(ctx context.Context, msg string, args ...any) {
	if l.level >= logger.Info {
		slog.InfoContext(ctx, "gorm "+fmt.Sprintf(msg, args...))
	}
}

func (l slogGormLogger) Warn(ctx context.Context, msg string, args ...any) {
	if l.level >= logger.Warn {
		slog.WarnContext(ctx, "gorm "+fmt.Sprintf(msg, args...))
	}
}

func (l slogGormLogger) Error(ctx context.Context, msg string, args ...any) {
	if l.level >= logger.Error {
		slog.ErrorContext(ctx, "gorm "+fmt.Sprintf(msg, args...))
	}
}

func (l slogGormLogger) Trace(ctx context.Context, begin time.Time, fc func() (string, int64), err error) {
	if l.level <= logger.Silent {
		return
	}
	elapsed := time.Since(begin)
	switch {
	case err != nil && l.level >= logger.Error && !errors.Is(err, gorm.ErrRecordNotFound):
		sql, rows := fc()
		slog.WarnContext(ctx, "gorm query failed", "elapsed", elapsed, "rows", rows, "sql", sql, "error", err)
	case l.slowThreshold > 0 && elapsed > l.slowThreshold && l.level >= logger.Warn:
		sql, rows := fc()
		slog.WarnContext(ctx, "gorm slow query", "elapsed", elapsed, "threshold", l.slowThreshold, "rows", rows, "sql", sql)
	case l.level >= logger.Info:
		sql, rows := fc()
		slog.InfoContext(ctx, "gorm query", "elapsed", elapsed, "rows", rows, "sql", sql)
	}
}
