# Generacion de stubs a partir de los contratos .proto
# Uso: make proto
PROTO_DIR := proto
GEN_DIR   := gen
TS_PROTO  := ../Practica7/Backend/proto

.PHONY: proto proto-go tidy test build

proto: proto-go

proto-go:
	protoc -I $(PROTO_DIR) \
		--go_out=$(GEN_DIR) --go_opt=module=github.com/yousac/academix-pass/backend/gen \
		--go-grpc_out=$(GEN_DIR) --go-grpc_opt=module=github.com/yousac/academix-pass/backend/gen \
		$(PROTO_DIR)/eventos.proto \
		$(PROTO_DIR)/catalogo.proto \
		$(PROTO_DIR)/reservas.proto \
		$(PROTO_DIR)/certificados.proto

tidy:
	go mod tidy

test:
	go test ./... -race -count=1

build:
	go build ./cmd/...
