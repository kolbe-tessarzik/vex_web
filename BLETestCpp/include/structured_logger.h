#pragma once

#include <cstring>
#include <functional>
#include <type_traits>
#include <vector>
// #include "static_vector.h"


inline void print(const char* fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    // Print formatted string
    std::vprintf(fmt, args);
    va_end(args);

    // Append newline and flush
    std::putchar('\n');
    std::fflush(stdout);
}

// ------------------------------------------------------------
// Compile-time fmt_code lookup
// ------------------------------------------------------------
template<typename T> struct always_false : std::false_type {};
template <typename T> struct fmt {
   static_assert(always_false<T>::value, "Unsupported type");
};
template <> struct fmt<int8_t>   { enum { code = 'b' }; };
template <> struct fmt<uint8_t>  { enum { code = 'B' }; };
template <> struct fmt<int16_t>  { enum { code = 'h' }; };
template <> struct fmt<uint16_t> { enum { code = 'H' }; };
template <> struct fmt<int32_t>  { enum { code = 'i' }; };
template <> struct fmt<uint32_t> { enum { code = 'I' }; };
template <> struct fmt<int64_t>  { enum { code = 'q' }; };
template <> struct fmt<uint64_t> { enum { code = 'Q' }; };
template <> struct fmt<float>    { enum { code = 'f' }; };
template <> struct fmt<double>   { enum { code = 'd' }; };

// Core helper: append an integer value in big-endian byte order
template<typename IntT>
void pack_integer_be(std::vector<uint8_t>& buf, IntT value)
{
    for (uint32_t i = 0; i < sizeof(IntT); ++i) {
        buf.push_back(static_cast<uint8_t>(value >> (8 * (sizeof(IntT) - 1 - i))));
    }
}

// Generic pack<T> for integral types
template<typename T>
void pack(std::vector<uint8_t>& buf, T value)
{
    static_assert(std::is_integral<T>::value, "pack<T>: integral types only");
    pack_integer_be(buf, value);
}

// Overload for float
void pack(std::vector<uint8_t>& buf, float value)
{
    uint32_t bits;
    std::memcpy(&bits, &value, sizeof(bits));
    pack_integer_be(buf, bits);
}

// Overload for double
void pack(std::vector<uint8_t>& buf, double value)
{
    uint64_t bits;
    std::memcpy(&bits, &value, sizeof(bits));
    pack_integer_be(buf, bits);
}

// Variable-length integer packing
template<typename T>
void pack_var_int(std::vector<uint8_t>& buf, T num)
{
    if ((num >= 0) && (num < 128))
    {
        pack<uint8_t>(buf, static_cast<uint8_t>(num));
        return;
    }
    if (num < 32768)
    {
        pack<uint16_t>(buf, static_cast<uint16_t>(num | 0x8000));
        return;
    }
    printf("WARNING: Number too large to pack (in pack_var_int): %lld\n", (long long)num);
}

template<typename T>
int var_int_size(T num)
{
    return (num < 128) ? 1 : 2;
}


void pack_len(std::vector<uint8_t>& buf, int offset)
{
    // -2 bytes for encoded length
    const int payload_len = buf.size() - offset - 2;
    if (payload_len >= 32768)
    {
        printf("WARNING: Number too large to pack (in pack_len): \n", payload_len);
        return;
    }

    // pack most significant byte and set most significant bit
    buf[offset]     = ((uint8_t)(payload_len >> 8)) | 0x80;
    buf[offset + 1] = (uint8_t)(payload_len);
}

class EntryBase
{
public:
    virtual ~EntryBase() {}
    virtual uint16_t code() const = 0;
    virtual const std::string& name() const = 0;
    virtual void pack(std::vector<uint8_t>& buf) = 0;
    virtual void pack_name_and_format(std::vector<uint8_t>& buf) = 0;
};

template<class T>
class Entry : public EntryBase
{
private:
    uint16_t m_code;
    std::string m_name;
    std::function<T()> m_getter;

public:
    Entry(const uint16_t code, const std::string &name, std::function<T()> getter)
        : m_code(code), m_name(name), m_getter(getter)
    {}

    virtual uint16_t code() const override
    {
        return m_code;
    }

    virtual const std::string& name() const override
    {
        return m_name;
    }

    virtual void pack(std::vector<uint8_t>& buf) override
    {
        pack_var_int(buf, m_code);
        ::pack(buf, m_getter());
    }

    virtual void pack_name_and_format(std::vector<uint8_t>& buf) override
    {
        // send code to identify value
        pack_var_int(buf, m_code);
        // send format code
        buf.push_back(fmt<T>::code);
        // send name (null-terminated)
        buf.insert(buf.end(), m_name.begin(), m_name.end());
        buf.push_back('\0');
    }
};

class StructuredLogger
{
private:
    std::array<uint8_t, 256> m_bufferStorage{};
    //static_vector<uint8_t> m_buffer{m_bufferStorage};

    std::vector<EntryBase *> m_registry{};
    uint16_t m_next_code = 0;
    int m_fmt_size = 0;
    int m_data_size = 0;


    static constexpr int header_len = 5;

    template<typename T>
    void add_impl(const std::string name, std::function<T()> func)
    {
        m_fmt_size += var_int_size(m_next_code) + 1 + name.size() + 1; // code + fmt + name + null
        m_data_size += var_int_size(m_next_code) + sizeof(T); // code + data
        m_registry.push_back((EntryBase *)(new Entry<T>(m_next_code++, name, func)));

    }

public:
    StructuredLogger() {}

    template<typename Func>
    void add(const std::string name, Func func)
    {
        add_impl(name, std::function<decltype(func())()>(func));
    }

    void send_data_format(void)
    {
        std::vector<uint8_t> buf{};
        buf.reserve(header_len + m_fmt_size);
        buf.push_back(0xc0); // special header
        buf.push_back(0xde); // special header
        buf.push_back(0x46); // data_format_command
        pack_var_int(buf, m_fmt_size); // payload length
        for (auto &entry : m_registry)
        {
            entry->pack_name_and_format(buf);
        }
        fwrite(buf.data(), 1, buf.size(), stdout);
        fflush(stdout);
    }

    void send_structured_data(void)
    {
        std::vector<uint8_t> buf{};
        buf.reserve(header_len + m_data_size);
        buf.push_back(0xc0); // special header
        buf.push_back(0xde); // special header
        buf.push_back(0x44); // structured_data_command
        pack_var_int(buf, m_data_size); // payload length
        for (auto &entry : m_registry)
        {
            entry->pack(buf);
        }
        fwrite(buf.data(), 1, buf.size(), stdout);
        fflush(stdout);
    }
};
