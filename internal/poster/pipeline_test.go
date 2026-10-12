package poster

import (
	"encoding/json"
	"image"
	"image/color"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) (string, string, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "source.png")
	img := image.NewNRGBA(image.Rect(0, 0, 2, 6))
	red := color.NRGBA{R: 160, G: 20, B: 40, A: 255}
	blue := color.NRGBA{R: 20, G: 80, B: 180, A: 255}
	for _, point := range []image.Point{{0, 1}, {0, 3}, {1, 3}, {0, 5}, {1, 5}} {
		img.SetNRGBA(point.X, point.Y, red)
	}
	img.SetNRGBA(1, 5, blue)
	if e := savePNG(path, img); e != nil {
		t.Fatal(e)
	}
	font, e := filepath.Abs("../../assets/fonts/Go-Mono.ttf")
	if e != nil {
		t.Fatal(e)
	}
	return dir, path, font
}
func TestMappingSkipsTransparencyWithoutConsumingBookText(t *testing.T) {
	dir, input, font := fixture(t)
	text := filepath.Join(dir, "text.txt")
	os.WriteFile(text, []byte("  A \n é!Zmore"), 0644)
	output := filepath.Join(dir, "mapping.json")
	result, e := Run("map", Job{Version: Version, Input: input, Output: output, Text: text, Font: font, Width: 400, Height: 1200, Columns: 2})
	if e != nil {
		t.Fatal(e)
	}
	data, _ := os.ReadFile(output)
	var mapping Mapping
	json.Unmarshal(data, &mapping)
	if result.CharactersUsed != 5 || mapping.Rows != 3 {
		t.Fatalf("unexpected grid: %+v", result)
	}
	positions := []image.Point{{0, 0}, {0, 1}, {1, 1}, {0, 2}, {1, 2}}
	var stream strings.Builder
	for i, cell := range mapping.Cells {
		if cell.X != positions[i].X || cell.Y != positions[i].Y {
			t.Fatalf("cell position %+v", cell)
		}
		stream.WriteString(cell.Character)
	}
	if stream.String() != "A é!Z" {
		t.Fatalf("text was reordered or skipped: %q", stream.String())
	}
	if mapping.Cells[4].Color != "#1450B4" {
		t.Fatal("RGB not preserved")
	}
	if result.TextExhausted {
		t.Fatal("unused body text was reported exhausted")
	}
	a, e := Run("render", Job{Version: Version, Input: output, Output: filepath.Join(dir, "a.png"), Background: "#FFFFFF"})
	if e != nil {
		t.Fatal(e)
	}
	b, e := Run("render", Job{Version: Version, Input: output, Output: filepath.Join(dir, "b.png"), Background: "#FFFFFF"})
	if e != nil {
		t.Fatal(e)
	}
	if a.SHA256 != b.SHA256 || a.PixelHash != b.PixelHash || a.Width != 400 || a.Height != 1200 {
		t.Fatal("offline render is not repeatable at requested dimensions")
	}
}
func TestTextExhaustionLeavesRemainingCellsEmpty(t *testing.T) {
	dir, input, font := fixture(t)
	text := filepath.Join(dir, "text.txt")
	os.WriteFile(text, []byte("Hi"), 0644)
	result, e := Run("map", Job{Version: Version, Input: input, Output: filepath.Join(dir, "mapping.json"), Text: text, Font: font, Width: 400, Height: 1200, Columns: 2})
	if e != nil {
		t.Fatal(e)
	}
	if result.CharactersUsed != 2 || result.VisibleCells != 5 || !result.TextExhausted {
		t.Fatalf("text repeated: %+v", result)
	}
}
func TestPreparationThresholdsAlphaAndPreservesRawMaster(t *testing.T) {
	dir, input, _ := fixture(t)
	original, _ := os.ReadFile(input)
	img, _ := readPNG(input)
	img.SetNRGBA(0, 0, color.NRGBA{R: 120, G: 10, A: 127})
	img.SetNRGBA(1, 0, color.NRGBA{R: 120, G: 10, A: 128})
	os.Remove(input)
	savePNG(input, img)
	original, _ = os.ReadFile(input)
	output := filepath.Join(dir, "prepared.png")
	_, e := Run("prepare", Job{Version: Version, Input: input, Output: output, Palette: []string{"#FF0000", "#0000FF"}, AlphaThreshold: 128})
	if e != nil {
		t.Fatal(e)
	}
	prepared, _ := readPNG(output)
	if prepared.NRGBAAt(0, 0).A != 0 || prepared.NRGBAAt(1, 0) != (color.NRGBA{R: 255, A: 255}) {
		t.Fatal("alpha threshold or palette snapping is incorrect")
	}
	after, _ := os.ReadFile(input)
	if Hash(after) != Hash(original) {
		t.Fatal("raw input was overwritten")
	}
	if _, e = Run("prepare", Job{Version: Version, Input: input, Output: output, Palette: []string{"#FF0000"}}); e == nil {
		t.Fatal("existing output overwritten")
	}
}
func TestRejectsOpaqueMatteAndInvalidLayouts(t *testing.T) {
	dir, input, font := fixture(t)
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: 255, A: 255})
		}
	}
	os.Remove(input)
	savePNG(input, img)
	if _, e := Run("prepare", Job{Version: Version, Input: input, Output: filepath.Join(dir, "prepared.png"), Palette: []string{"#FF0000"}}); e == nil {
		t.Fatal("opaque matte accepted")
	}
	text := filepath.Join(dir, "text.txt")
	os.WriteFile(text, []byte("text"), 0644)
	if _, e := Run("map", Job{Version: Version, Input: input, Output: filepath.Join(dir, "mapping.json"), Text: text, Font: font, Width: 400, Height: 600, Margin: 300}); e == nil {
		t.Fatal("invalid margin accepted")
	}
}

func TestMissingFontGlyphIsReportedInsteadOfSilentlyDroppingText(t *testing.T) {
	dir, input, font := fixture(t)
	text := filepath.Join(dir, "text.txt")
	os.WriteFile(text, []byte("😀"), 0644)
	_, e := Run("map", Job{Version: Version, Input: input, Output: filepath.Join(dir, "mapping.json"), Text: text, Font: font, Width: 400, Height: 1200, Columns: 2})
	if e == nil || !strings.Contains(e.Error(), "cannot render story character") {
		t.Fatalf("missing glyph not reported: %v", e)
	}
}
