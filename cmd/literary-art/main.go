package main

import (
	"encoding/json"
	"fmt"
	"github.com/CarterSimonson/literary-ascii-art-v2/internal/poster"
	"io"
	"os"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: literary-art prepare|map|render|inspect job.json")
		os.Exit(2)
	}
	f, e := os.Open(os.Args[2])
	if e != nil {
		fail(e)
	}
	defer f.Close()
	var job poster.Job
	d := json.NewDecoder(f)
	d.DisallowUnknownFields()
	if e = d.Decode(&job); e != nil {
		fail(e)
	}
	if e = d.Decode(new(any)); e != io.EOF {
		fail(fmt.Errorf("job must contain exactly one JSON object"))
	}
	result, e := poster.Run(os.Args[1], job)
	if e != nil {
		fail(e)
	}
	if e = json.NewEncoder(os.Stdout).Encode(result); e != nil {
		fail(e)
	}
}
func fail(e error) { fmt.Fprintln(os.Stderr, e); os.Exit(1) }
